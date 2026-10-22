from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.base import utcnow
from app.models.audit import AuditLog
from app.models.enums import AuditActorType, AuditEventType, ReturnStatus
from app.models.order import Customer
from app.models.user import User
from app.schemas.audit import AuditEntryResponse, AuditFilters, actor_label

MAX_DESCRIPTION_LENGTH = 300
MAX_PARAM_LENGTH = 80
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")

# Fixed wording. Parameters are system-generated values (references, counts, amounts),
# never free-form customer text, secrets or tokens.
TEMPLATES: dict[AuditEventType, str] = {
    AuditEventType.RETURN_SUBMITTED: "Return request {reference} submitted.",
    AuditEventType.POLICY_EVALUATED: "Policy check {outcome} ({passed} of {total} checks passed).",
    AuditEventType.AI_ANALYSIS_GENERATED: "Case analysis generated ({source}).",
    AuditEventType.REVIEW_STARTED: "Review started.",
    AuditEventType.RETURN_APPROVED: "Return approved.",
    AuditEventType.RETURN_REJECTED: "Return rejected.",
    AuditEventType.REFUND_INITIATED: "Refund of {amount} initiated.",
    AuditEventType.REFUND_COMPLETED: "Refund of {amount} confirmed by PayPal.",
    AuditEventType.REFUND_FAILED: "Refund of {amount} failed.",
    AuditEventType.POLICY_UPDATED: "Return policy updated ({changes}).",
}


def _clean(value: object) -> str:
    text = _CONTROL_CHARS.sub(" ", str(value)).strip()
    return text[:MAX_PARAM_LENGTH]


def describe(event_type: AuditEventType, **params: object) -> str:
    """Build a description from the fixed template for `event_type`."""
    template = TEMPLATES[event_type]
    safe = {key: _clean(value) for key, value in params.items()}
    try:
        text = template.format(**safe)
    except KeyError as exc:
        raise ValueError(f"Missing audit parameter: {exc.args[0]}") from exc
    return text[:MAX_DESCRIPTION_LENGTH]


def record_event(
    db: Session,
    *,
    seller_id: str,
    event_type: AuditEventType,
    actor_type: AuditActorType,
    description: str,
    actor_id: str | None = None,
    return_id: str | None = None,
    from_status: ReturnStatus | None = None,
    to_status: ReturnStatus | None = None,
    occurred_at: datetime | None = None,
) -> AuditLog:
    """Add an audit entry to the session. It never commits.

    The entry is saved or rolled back together with the change it describes, so a failed
    action leaves no entry behind and a successful one never lacks one.
    """
    if actor_type in (AuditActorType.SELLER, AuditActorType.CUSTOMER) and not actor_id:
        raise ValueError("Seller and customer actors need an actor_id")
    if actor_type in (AuditActorType.SYSTEM, AuditActorType.AI) and actor_id is not None:
        raise ValueError("System and AI actors must not have an actor_id")
    if not description or len(description) > MAX_DESCRIPTION_LENGTH:
        raise ValueError("Audit description is empty or too long")
    if _CONTROL_CHARS.search(description):
        raise ValueError("Audit description contains control characters")
    if occurred_at is not None and occurred_at.tzinfo is None:
        raise ValueError("occurred_at must be timezone-aware")

    entry = AuditLog(
        seller_id=seller_id,
        return_id=return_id,
        event_type=event_type,
        actor_type=actor_type,
        actor_id=actor_id,
        description=description,
        from_status=from_status,
        to_status=to_status,
        occurred_at=occurred_at or utcnow(),
    )
    db.add(entry)
    return entry


def _resolve_names(db: Session, seller_id: str, entries: list[AuditLog]) -> dict[str, str]:
    ids = {entry.actor_id for entry in entries if entry.actor_id}
    if not ids:
        return {}

    names: dict[str, str] = {}
    for user_id, display_name in db.execute(
        select(User.id, User.display_name).where(User.id.in_(ids))
    ):
        names[user_id] = display_name
    for customer_id, name in db.execute(
        select(Customer.id, Customer.name).where(
            Customer.id.in_(ids), Customer.seller_id == seller_id
        )
    ):
        names[customer_id] = name
    return names


def list_audit_entries(
    db: Session, seller_id: str, filters: AuditFilters
) -> list[AuditEntryResponse]:
    """Newest first, always limited to one seller's own entries."""
    statement = select(AuditLog).where(AuditLog.seller_id == seller_id)
    if filters.return_id is not None:
        statement = statement.where(AuditLog.return_id == filters.return_id)
    if filters.event_type is not None:
        statement = statement.where(AuditLog.event_type == filters.event_type)
    if filters.actor_type is not None:
        statement = statement.where(AuditLog.actor_type == filters.actor_type)
    statement = statement.order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc()).limit(
        filters.limit
    )

    entries = list(db.scalars(statement))
    names = _resolve_names(db, seller_id, entries)
    return [AuditEntryResponse.from_model(entry, actor_label(entry, names)) for entry in entries]