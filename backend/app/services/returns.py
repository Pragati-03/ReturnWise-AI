from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.core.money import parse_money
from app.db.base import utcnow
from app.models.case import PolicyEvaluation
from app.models.enums import AuditActorType, AuditEventType, ReturnStatus
from app.models.policy import ReturnPolicy
from app.models.return_request import ReturnRequest, ReturnRequestItem
from app.schemas.return_request import CreateReturnRequest
from app.services.audit import describe, record_event
from app.services.errors import ConflictError, DomainError, InvalidInputError, NotFoundError
from app.services.orders import get_order
from app.services.policy_engine import PolicyInput, PolicyLine, evaluate_return

logger = logging.getLogger(__name__)

MAX_LIMIT = 500
REFERENCE_PREFIX = "RET-"
FIRST_REFERENCE_NUMBER = 1001
CONFLICT_MESSAGE = "This was changed by someone else at the same time. Reload and try again."

# A rejected request frees its items. A refunded one still used them up, but no longer
# blocks a new request for the same item.
FINISHED_STATUSES = frozenset({ReturnStatus.REJECTED, ReturnStatus.REFUNDED})


# ---------- Transaction safety ----------


def _conflict_from(exc: Exception) -> ConflictError | None:
    # Only "database is locked" counts as a conflict; other database errors are real bugs.
    if isinstance(exc, OperationalError) and "locked" not in str(exc.orig).lower():
        return None
    logger.warning("Write conflict (%s): %s", type(exc).__name__, getattr(exc, "orig", exc))
    return ConflictError(CONFLICT_MESSAGE)


@contextmanager
def write_guard(db: Session) -> Iterator[None]:
    """Wrap a write operation.

    - Any domain error rolls the transaction back, so nothing half-done is kept.
    - A concurrent-write failure (stale version, unique clash, SQLite lock) becomes a clean
      409 instead of a 500.
    """
    try:
        yield
    except DomainError:
        db.rollback()
        raise
    except (StaleDataError, IntegrityError, OperationalError) as exc:
        db.rollback()
        conflict = _conflict_from(exc)
        if conflict is None:
            raise
        raise conflict from exc


# ---------- Policy ----------


def get_or_create_policy(db: Session, seller_id: str) -> ReturnPolicy:
    """The seller's policy, created with defaults on first use."""
    statement = select(ReturnPolicy).where(ReturnPolicy.seller_id == seller_id)
    policy = db.scalar(statement)
    if policy is not None:
        return policy
    try:
        with db.begin_nested():  # savepoint, so a lost race doesn't spoil the outer transaction
            policy = ReturnPolicy(seller_id=seller_id)
            db.add(policy)
    except IntegrityError:
        policy = db.scalar(statement)
        if policy is None:
            raise
    return policy


# ---------- Reads ----------


def list_returns(
    db: Session,
    seller_id: str,
    status: ReturnStatus | None = None,
    *,
    limit: int = MAX_LIMIT,
) -> list[ReturnRequest]:
    limit = max(1, min(limit, MAX_LIMIT))
    statement = select(ReturnRequest).where(ReturnRequest.seller_id == seller_id)
    if status is not None:
        statement = statement.where(ReturnRequest.status == status)
    statement = statement.order_by(
        ReturnRequest.submitted_at.desc(), ReturnRequest.id.desc()
    ).limit(limit)
    return list(db.scalars(statement))


def get_return(db: Session, seller_id: str, return_id: str) -> ReturnRequest:
    request = db.scalar(
        select(ReturnRequest).where(
            ReturnRequest.id == return_id, ReturnRequest.seller_id == seller_id
        )
    )
    if request is None:
        raise NotFoundError("Return request not found.")
    return request


def latest_evaluation(db: Session, seller_id: str, return_id: str) -> PolicyEvaluation | None:
    return db.scalar(
        select(PolicyEvaluation)
        .where(PolicyEvaluation.seller_id == seller_id, PolicyEvaluation.return_id == return_id)
        .order_by(PolicyEvaluation.evaluated_at.desc(), PolicyEvaluation.id.desc())
        .limit(1)
    )


# ---------- Create ----------


def _line_usage(db: Session, order_id: str) -> tuple[dict[str, int], set[str]]:
    """Units already claimed per order line, and the lines covered by a still-open request."""
    rows = db.execute(
        select(
            ReturnRequestItem.order_item_id,
            ReturnRequest.status,
            func.sum(ReturnRequestItem.quantity),
        )
        .join(ReturnRequest, ReturnRequest.id == ReturnRequestItem.return_id)
        .where(ReturnRequest.order_id == order_id, ReturnRequest.status != ReturnStatus.REJECTED)
        .group_by(ReturnRequestItem.order_item_id, ReturnRequest.status)
    )
    used: dict[str, int] = {}
    open_items: set[str] = set()
    for item_id, status, total in rows:
        used[item_id] = used.get(item_id, 0) + int(total)
        if status not in FINISHED_STATUSES:
            open_items.add(item_id)
    return used, open_items


def _next_reference(db: Session, seller_id: str) -> str:
    count = db.scalar(
        select(func.count()).select_from(ReturnRequest).where(ReturnRequest.seller_id == seller_id)
    )
    return f"{REFERENCE_PREFIX}{FIRST_REFERENCE_NUMBER + (count or 0)}"


def create_return(
    db: Session,
    seller_id: str,
    payload: CreateReturnRequest,
    *,
    now: datetime | None = None,
) -> ReturnRequest:
    """File a return request for one of the seller's orders.

    Ownership, item and duplicate checks, the policy evaluation, the audit entries and the
    commit all happen in a single transaction. A request that breaks the return policy is
    still stored, with its failed checks, so the seller can see why and reject it.
    """
    moment = now or utcnow()

    with write_guard(db):
        order = get_order(db, seller_id, payload.order_id)

        # Touch the order first. Its version check means two requests for the same order
        # cannot both pass the duplicate and quantity checks below: the loser gets a 409.
        order.updated_at = utcnow()
        db.flush()

        items_by_id = {item.id: item for item in order.items}
        chosen = []
        for line in payload.items:
            item = items_by_id.get(line.order_item_id)
            if item is None:
                raise InvalidInputError("One or more items do not belong to this order.")
            chosen.append((item, line.quantity))

        used, open_items = _line_usage(db, order.id)
        covered = [item.name for item, _ in chosen if item.id in open_items]
        if covered:
            raise ConflictError(f"An open return request already covers: {', '.join(covered)}.")

        policy = get_or_create_policy(db, seller_id)
        requested_minor = parse_money(payload.requested_amount)

        result = evaluate_return(
            PolicyInput(
                now=moment,
                currency=order.currency.value,
                payment_status=order.payment_status,
                delivered_at=order.delivered_at,
                order_total_minor=order.total_minor,
                order_refunded_minor=order.refunded_minor,
                lines=tuple(
                    PolicyLine(
                        order_item_id=item.id,
                        name=item.name,
                        ordered_quantity=item.quantity,
                        returnable=item.returnable,
                        unit_price_minor=item.unit_price_minor,
                        requested_quantity=quantity,
                        already_requested_quantity=used.get(item.id, 0),
                        has_other_active_request=item.id in open_items,
                    )
                    for item, quantity in chosen
                ),
                requested_minor=requested_minor,
                return_window_days=policy.return_window_days,
                require_payment_captured=policy.require_payment_captured,
                allow_partial_refunds=policy.allow_partial_refunds,
                manual_review_threshold_minor=policy.manual_review_threshold_minor,
                restocking_fee_bps=policy.restocking_fee_bps,
            )
        )

        request = ReturnRequest(
            seller_id=seller_id,
            order=order,
            customer=order.customer,
            reference=_next_reference(db, seller_id),
            status=ReturnStatus.SUBMITTED,
            customer_comment=payload.customer_comment,
            requested_minor=requested_minor,
            currency=order.currency,
            submitted_at=moment,
        )
        request.items = [
            ReturnRequestItem(order_item_id=item.id, quantity=quantity) for item, quantity in chosen
        ]
        db.add(request)
        db.flush()

        db.add(
            PolicyEvaluation(
                seller_id=seller_id,
                return_id=request.id,
                eligible=result.eligible,
                checks=result.as_dicts(),
                evaluated_at=moment,
            )
        )

        # Seller accounts are the only logged-in users, so the seller is recorded as the actor
        # (the customer is not authenticated). The 1-microsecond gap keeps the order stable.
        record_event(
            db,
            seller_id=seller_id,
            event_type=AuditEventType.RETURN_SUBMITTED,
            actor_type=AuditActorType.SELLER,
            actor_id=seller_id,
            description=describe(AuditEventType.RETURN_SUBMITTED, reference=request.reference),
            return_id=request.id,
            to_status=ReturnStatus.SUBMITTED,
            occurred_at=moment,
        )
        passed = sum(1 for check in result.checks if check.passed)
        record_event(
            db,
            seller_id=seller_id,
            event_type=AuditEventType.POLICY_EVALUATED,
            actor_type=AuditActorType.SYSTEM,
            description=describe(
                AuditEventType.POLICY_EVALUATED,
                outcome="passed" if result.eligible else "failed",
                passed=passed,
                total=len(result.checks),
            ),
            return_id=request.id,
            occurred_at=moment + timedelta(microseconds=1),
        )

        db.commit()

    return request