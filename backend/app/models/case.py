from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UTCDateTime, new_id, utcnow
from app.models.enums import (
    AnalysisSource,
    Currency,
    RefundStatus,
    ReturnReasonCategory,
    SuggestedAction,
    enum_check,
    str_enum,
)


class PolicyEvaluation(Base):
    """Result of the deterministic policy check for a return, kept as a permanent record.

    A new row is written each time the policy is evaluated; the latest one counts.
    `checks` is a list of {code, label, passed, detail} objects using the reason codes
    from the policy engine. The API schema validates its shape on the way in and out.
    """

    __tablename__ = "policy_evaluations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("pev"))
    seller_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    return_id: Mapped[str] = mapped_column(
        ForeignKey("return_requests.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    eligible: Mapped[bool] = mapped_column(Boolean, nullable=False)
    checks: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    evaluated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<PolicyEvaluation {self.id} eligible={self.eligible}>"


class AiAnalysis(Base):
    """Advisory case analysis. Never used for eligibility or payment decisions.

    `source` records honestly where it came from: "ai" (Gemini) or "fallback"
    (deterministic rules). The frontend's "demo" label never reaches the database.
    """

    __tablename__ = "ai_analyses"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("ana"))
    seller_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    return_id: Mapped[str] = mapped_column(
        ForeignKey("return_requests.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    source: Mapped[AnalysisSource] = mapped_column(str_enum(AnalysisSource), nullable=False)
    # Model identifier for "ai" rows; empty for "fallback".
    model_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    category: Mapped[ReturnReasonCategory] = mapped_column(
        str_enum(ReturnReasonCategory), nullable=False
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    key_points: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    suggested_action: Mapped[SuggestedAction] = mapped_column(
        str_enum(SuggestedAction), nullable=False
    )
    rationale: Mapped[str] = mapped_column(Text, nullable=False)
    # Whole percent, 0 to 100. The API converts to the 0..1 value the frontend uses.
    confidence_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)

    __table_args__ = (
        CheckConstraint("confidence_percent BETWEEN 0 AND 100", name="confidence_in_range"),
        enum_check("source", AnalysisSource, "source_valid"),
        enum_check("category", ReturnReasonCategory, "category_valid"),
        enum_check("suggested_action", SuggestedAction, "suggested_action_valid"),
    )

    def __repr__(self) -> str:
        return f"<AiAnalysis {self.id} {self.source}>"


class Refund(TimestampMixin, Base):
    """One refund attempt for a return. A failed attempt stays as history; a retry is a new row.

    A row may only become "completed" after PayPal has confirmed it. Nothing in this model
    or the demo/test code may set a PayPal refund ID that PayPal did not return.
    """

    __tablename__ = "refunds"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("rfd"))
    seller_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    return_id: Mapped[str] = mapped_column(
        ForeignKey("return_requests.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    order_id: Mapped[str] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), index=True, nullable=False
    )

    amount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[Currency] = mapped_column(str_enum(Currency, 3), nullable=False)
    status: Mapped[RefundStatus] = mapped_column(
        str_enum(RefundStatus), default=RefundStatus.PENDING, nullable=False
    )

    # The client-supplied Idempotency-Key for this attempt. Unique, so replays can't create twins.
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Returned by PayPal. NULL until PayPal confirms; unique once present.
    paypal_refund_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    # Short, user-safe reason. Never raw provider error bodies or secrets.
    failure_reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # Optimistic locking, so an API request and a webhook can't both finalize the same refund.
    version_id: Mapped[int] = mapped_column(Integer, nullable=False)
    __mapper_args__ = {"version_id_col": version_id}

    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="amount_positive"),
        enum_check("status", RefundStatus, "status_valid"),
        enum_check("currency", Currency, "currency_valid"),
        # At most ONE active (pending or completed) refund per return, enforced by the
        # database itself. Failed attempts don't count, so a retry is allowed.
        Index(
            "uq_refunds_return_id_active",
            "return_id",
            unique=True,
            sqlite_where=text("status IN ('pending', 'completed')"),
            postgresql_where=text("status IN ('pending', 'completed')"),
        ),
    )

    def __repr__(self) -> str:
        return f"<Refund {self.id} {self.status}>"