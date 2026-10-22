from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, event
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UTCDateTime, new_id, utcnow
from app.models.enums import AuditActorType, AuditEventType, ReturnStatus, enum_check, str_enum


class AuditLogImmutableError(RuntimeError):
    """Raised when code tries to change or delete an audit entry."""


class AuditLog(Base):
    """One significant action. Append-only: never updated, never deleted by the app.

    Stores IDs and state changes, not names or emails. The API resolves display names
    when it reads entries. Descriptions are written by the services from fixed templates;
    they must never contain secrets, tokens, card data or free-form customer text.
    """

    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("aud"))
    seller_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    # NULL for account-level events such as a policy change.
    return_id: Mapped[str | None] = mapped_column(
        ForeignKey("return_requests.id", ondelete="RESTRICT"), index=True, nullable=True
    )

    event_type: Mapped[AuditEventType] = mapped_column(str_enum(AuditEventType), nullable=False)
    actor_type: Mapped[AuditActorType] = mapped_column(str_enum(AuditActorType), nullable=False)
    # Seller user ID or customer ID. NULL for "system" and "ai" actors.
    actor_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    description: Mapped[str] = mapped_column(String(300), nullable=False)
    from_status: Mapped[ReturnStatus | None] = mapped_column(str_enum(ReturnStatus), nullable=True)
    to_status: Mapped[ReturnStatus | None] = mapped_column(str_enum(ReturnStatus), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (
        Index("ix_audit_logs_seller_id_occurred_at", "seller_id", "occurred_at"),
        enum_check("event_type", AuditEventType, "event_type_valid"),
        enum_check("actor_type", AuditActorType, "actor_type_valid"),
        enum_check("from_status", ReturnStatus, "from_status_valid"),
        enum_check("to_status", ReturnStatus, "to_status_valid"),
    )

    def __repr__(self) -> str:
        return f"<AuditLog {self.id} {self.event_type}>"


@event.listens_for(AuditLog, "before_update")
def _block_update(_mapper, _connection, _target) -> None:  # type: ignore[no-untyped-def]
    raise AuditLogImmutableError("Audit log entries cannot be modified")


@event.listens_for(AuditLog, "before_delete")
def _block_delete(_mapper, _connection, _target) -> None:  # type: ignore[no-untyped-def]
    raise AuditLogImmutableError("Audit log entries cannot be deleted")