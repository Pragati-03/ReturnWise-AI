from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UTCDateTime, new_id, utcnow
from app.models.enums import enum_check, str_enum


class IdempotencyStatus(enum.StrEnum):
    STARTED = "started"
    COMPLETED = "completed"


class WebhookProcessingStatus(enum.StrEnum):
    RECEIVED = "received"
    PROCESSED = "processed"
    IGNORED = "ignored"
    FAILED = "failed"


class IdempotencyKey(Base):
    """Remembers a client-supplied Idempotency-Key for a sensitive action (e.g. a refund).

    Same key and same request -> return the stored result.
    Same key and a different request -> refuse (request_hash differs).
    The unique constraint makes concurrent duplicates fail at the database, not in app logic.
    """

    __tablename__ = "idempotency_keys"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("idk"))
    seller_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    # What the key applies to, e.g. "refund:ret_ab12...". Keeps keys from colliding across actions.
    scope: Mapped[str] = mapped_column(String(80), nullable=False)
    key: Mapped[str] = mapped_column(String(64), nullable=False)
    # SHA-256 of the canonical request. Hashed, so the payload itself is never stored.
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[IdempotencyStatus] = mapped_column(
        str_enum(IdempotencyStatus), default=IdempotencyStatus.STARTED, nullable=False
    )
    # ID of the object the action produced (e.g. the refund ID), once completed.
    result_ref: Mapped[str | None] = mapped_column(String(32), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "seller_id", "scope", "key", name="uq_idempotency_keys_seller_id_scope_key"
        ),
        enum_check("status", IdempotencyStatus, "status_valid"),
    )

    def __repr__(self) -> str:
        return f"<IdempotencyKey {self.id} {self.status}>"


class PaypalWebhookEvent(Base):
    """One PayPal webhook delivery. paypal_event_id is unique, so a redelivery can't run twice.

    Stores only what is needed to deduplicate and trace: the event ID, type and the related
    resource ID. The raw payload is deliberately NOT stored, because it can contain payer
    personal details.
    """

    __tablename__ = "paypal_webhook_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("whe"))
    paypal_event_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    # The PayPal capture or refund ID the event refers to, used to find our own record.
    resource_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Set once the owning seller is resolved from our own records (never from the payload alone).
    seller_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=True
    )
    # True only if PayPal's signature verification succeeded for this delivery.
    signature_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    processing_status: Mapped[WebhookProcessingStatus] = mapped_column(
        str_enum(WebhookProcessingStatus),
        default=WebhookProcessingStatus.RECEIVED,
        nullable=False,
    )
    # Short internal note for failures. No provider response bodies or secrets.
    error: Mapped[str | None] = mapped_column(String(300), nullable=True)
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    __table_args__ = (
        Index("ix_paypal_webhook_events_resource_id", "resource_id"),
        enum_check("processing_status", WebhookProcessingStatus, "processing_status_valid"),
    )

    def __repr__(self) -> str:
        return f"<PaypalWebhookEvent {self.id} {self.processing_status}>"