from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.money import format_minor
from app.db.base import utcnow
from app.models.enums import AuditActorType, AuditEventType
from app.models.policy import ReturnPolicy
from app.schemas.settings import PolicyUpdateRequest
from app.services.audit import MAX_PARAM_LENGTH, describe, record_event
from app.services.errors import InvalidInputError
from app.services.returns import get_or_create_policy, write_guard


def get_policy(db: Session, seller_id: str) -> ReturnPolicy:
    """The seller's policy. A default one is created and saved on first use."""
    with write_guard(db):
        policy = get_or_create_policy(db, seller_id)
        db.commit()
    return policy


def _percent(bps: int) -> str:
    return f"{Decimal(bps) / 100:f}"  # exact: 250 -> "2.5", 0 -> "0"


def _changes(policy: ReturnPolicy, payload: PolicyUpdateRequest) -> list[str]:
    changes: list[str] = []
    if policy.return_window_days != payload.return_window_days:
        changes.append(
            f"return window {policy.return_window_days} to {payload.return_window_days} days"
        )
    if policy.manual_review_threshold_minor != payload.manual_review_threshold_minor:
        changes.append(
            f"review threshold {format_minor(policy.manual_review_threshold_minor)} "
            f"to {format_minor(payload.manual_review_threshold_minor)}"
        )
    if policy.restocking_fee_bps != payload.restocking_fee_bps:
        changes.append(
            f"restocking fee {_percent(policy.restocking_fee_bps)}% "
            f"to {_percent(payload.restocking_fee_bps)}%"
        )
    if policy.require_payment_captured != payload.require_payment_captured:
        changes.append(
            "payment capture requirement " + ("on" if payload.require_payment_captured else "off")
        )
    if policy.allow_partial_refunds != payload.allow_partial_refunds:
        changes.append("partial refunds " + ("allowed" if payload.allow_partial_refunds else "blocked"))
    return changes


def update_policy(
    db: Session,
    seller_id: str,
    payload: PolicyUpdateRequest,
    *,
    now: datetime | None = None,
) -> ReturnPolicy:
    moment = now or utcnow()
    with write_guard(db):
        policy = get_or_create_policy(db, seller_id)

        if payload.currency != policy.currency:
            raise InvalidInputError("The currency cannot be changed.")

        changes = _changes(policy, payload)
        if not changes:
            db.commit()  # saves a freshly created default policy, if there was one
            return policy

        summary = ", ".join(changes)
        if len(summary) > MAX_PARAM_LENGTH:
            summary = f"{len(changes)} settings changed"

        policy.return_window_days = payload.return_window_days
        policy.require_payment_captured = payload.require_payment_captured
        policy.allow_partial_refunds = payload.allow_partial_refunds
        policy.manual_review_threshold_minor = payload.manual_review_threshold_minor
        policy.restocking_fee_bps = payload.restocking_fee_bps

        record_event(
            db,
            seller_id=seller_id,
            event_type=AuditEventType.POLICY_UPDATED,
            actor_type=AuditActorType.SELLER,
            actor_id=seller_id,
            description=describe(AuditEventType.POLICY_UPDATED, changes=summary),
            occurred_at=moment,
        )
        db.commit()
    return policy