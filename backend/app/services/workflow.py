from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.enums import AuditActorType, AuditEventType, ReturnStatus
from app.models.return_request import ReturnRequest
from app.services.audit import describe, record_event
from app.services.errors import InvalidInputError, InvalidTransitionError, PolicyViolationError
from app.services.returns import get_return, latest_evaluation, write_guard

MAX_NOTE_LENGTH = 500

# Same table as the frontend demo store. Refund steps are driven by the refund service later.
ALLOWED_TRANSITIONS: dict[ReturnStatus, frozenset[ReturnStatus]] = {
    ReturnStatus.SUBMITTED: frozenset({ReturnStatus.UNDER_REVIEW}),
    ReturnStatus.UNDER_REVIEW: frozenset({ReturnStatus.APPROVED, ReturnStatus.REJECTED}),
    ReturnStatus.APPROVED: frozenset({ReturnStatus.REFUND_PENDING}),
    ReturnStatus.REJECTED: frozenset(),
    ReturnStatus.REFUND_PENDING: frozenset({ReturnStatus.REFUNDED, ReturnStatus.REFUND_FAILED}),
    ReturnStatus.REFUNDED: frozenset(),
    ReturnStatus.REFUND_FAILED: frozenset({ReturnStatus.REFUND_PENDING}),
}


def can_transition(from_status: ReturnStatus, to_status: ReturnStatus) -> bool:
    return to_status in ALLOWED_TRANSITIONS[from_status]


def ensure_transition(from_status: ReturnStatus, to_status: ReturnStatus) -> None:
    if not can_transition(from_status, to_status):
        raise InvalidTransitionError(from_status.value, to_status.value)


def _move(
    db: Session,
    request: ReturnRequest,
    to_status: ReturnStatus,
    event_type: AuditEventType,
    seller_id: str,
    moment: datetime,
) -> None:
    """Change the status and add the audit entry. The caller commits."""
    from_status = request.status
    ensure_transition(from_status, to_status)
    request.status = to_status
    record_event(
        db,
        seller_id=seller_id,
        event_type=event_type,
        actor_type=AuditActorType.SELLER,
        actor_id=seller_id,  # seller accounts are the only users, so owner and actor coincide
        description=describe(event_type),
        return_id=request.id,
        from_status=from_status,
        to_status=to_status,
        occurred_at=moment,
    )


def start_review(
    db: Session, seller_id: str, return_id: str, *, now: datetime | None = None
) -> ReturnRequest:
    moment = now or utcnow()
    with write_guard(db):
        request = get_return(db, seller_id, return_id)
        _move(db, request, ReturnStatus.UNDER_REVIEW, AuditEventType.REVIEW_STARTED, seller_id, moment)
        db.commit()
    return request


def approve_return(
    db: Session,
    seller_id: str,
    return_id: str,
    note: str = "",
    *,
    now: datetime | None = None,
) -> ReturnRequest:
    moment = now or utcnow()
    clean_note = note.strip()
    with write_guard(db):
        request = get_return(db, seller_id, return_id)
        ensure_transition(request.status, ReturnStatus.APPROVED)

        if len(clean_note) > MAX_NOTE_LENGTH:
            raise InvalidInputError(f"Note must be {MAX_NOTE_LENGTH} characters or fewer.")

        # Approval always rests on a stored, deterministic policy result. AI cannot change it.
        evaluation = latest_evaluation(db, seller_id, return_id)
        if evaluation is None:
            raise PolicyViolationError(
                "No policy result is available, so this request cannot be approved."
            )
        if not evaluation.eligible:
            raise PolicyViolationError(
                "This request failed the policy checks and cannot be approved."
            )

        request.decision_note = clean_note or None
        request.decided_at = moment
        _move(db, request, ReturnStatus.APPROVED, AuditEventType.RETURN_APPROVED, seller_id, moment)
        db.commit()
    return request


def reject_return(
    db: Session,
    seller_id: str,
    return_id: str,
    note: str,
    *,
    now: datetime | None = None,
) -> ReturnRequest:
    moment = now or utcnow()
    clean_note = note.strip()
    with write_guard(db):
        request = get_return(db, seller_id, return_id)
        ensure_transition(request.status, ReturnStatus.REJECTED)

        if not clean_note:
            raise InvalidInputError("A note is required when rejecting a return.")
        if len(clean_note) > MAX_NOTE_LENGTH:
            raise InvalidInputError(f"Note must be {MAX_NOTE_LENGTH} characters or fewer.")

        request.decision_note = clean_note
        request.decided_at = moment
        _move(db, request, ReturnStatus.REJECTED, AuditEventType.RETURN_REJECTED, seller_id, moment)
        db.commit()
    return request