from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, new_id
from app.models.enums import Currency, enum_check, str_enum


class ReturnPolicy(TimestampMixin, Base):
    """A seller's return rules. Exactly one row per seller (seller_id is unique)."""

    __tablename__ = "return_policies"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("pol"))
    seller_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), unique=True, nullable=False
    )

    # Days after delivery during which a return can be requested.
    return_window_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    require_payment_captured: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allow_partial_refunds: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Requests above this amount are flagged for manual review. Integer cents (150.00 -> 15000).
    manual_review_threshold_minor: Mapped[int] = mapped_column(
        BigInteger, default=15_000, nullable=False
    )
    # Basis points: 0 to 10000 (100% = 10000). The API converts to and from a percentage.
    restocking_fee_bps: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    currency: Mapped[Currency] = mapped_column(
        str_enum(Currency, 3), default=Currency.USD, nullable=False
    )

    __table_args__ = (
        CheckConstraint("return_window_days BETWEEN 1 AND 365", name="window_in_range"),
        CheckConstraint("manual_review_threshold_minor >= 0", name="threshold_non_negative"),
        CheckConstraint("restocking_fee_bps BETWEEN 0 AND 10000", name="fee_in_range"),
        enum_check("currency", Currency, "currency_valid"),
    )

    def __repr__(self) -> str:
        return f"<ReturnPolicy {self.id}>"