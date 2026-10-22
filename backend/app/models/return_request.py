from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UTCDateTime, new_id
from app.models.enums import Currency, ReturnStatus, enum_check, str_enum
from app.models.order import Customer, Order, OrderItem


class ReturnRequest(TimestampMixin, Base):
    __tablename__ = "return_requests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("ret"))
    seller_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    order_id: Mapped[str] = mapped_column(
        ForeignKey("orders.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    # Human-friendly reference such as "RET-1042", unique per seller. Assigned by the service.
    reference: Mapped[str] = mapped_column(String(32), nullable=False)

    status: Mapped[ReturnStatus] = mapped_column(
        str_enum(ReturnStatus), default=ReturnStatus.SUBMITTED, nullable=False
    )

    # UNTRUSTED customer text. Length is capped by the API schema; always treat as plain text,
    # and treat it as hostile input whenever it is passed to an AI prompt.
    customer_comment: Mapped[str] = mapped_column(Text, default="", nullable=False)

    requested_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    currency: Mapped[Currency] = mapped_column(str_enum(Currency, 3), nullable=False)

    submitted_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    decision_note: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Optimistic locking: two sellers (or two tabs) deciding the same request at once
    # can't both succeed. The loser gets StaleDataError, which the service turns into a 409.
    version_id: Mapped[int] = mapped_column(Integer, nullable=False)
    __mapper_args__ = {"version_id_col": version_id}

    order: Mapped[Order] = relationship(lazy="joined")
    customer: Mapped[Customer] = relationship(lazy="joined")
    items: Mapped[list[ReturnRequestItem]] = relationship(
        back_populates="return_request",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    __table_args__ = (
        UniqueConstraint("seller_id", "reference", name="uq_return_requests_seller_id_reference"),
        Index("ix_return_requests_seller_id_status", "seller_id", "status"),
        CheckConstraint("requested_minor > 0", name="requested_positive"),
        enum_check("status", ReturnStatus, "status_valid"),
        enum_check("currency", Currency, "currency_valid"),
    )

    def __repr__(self) -> str:
        return f"<ReturnRequest {self.id} {self.status}>"


class ReturnRequestItem(Base):
    """One order line (and how many units of it) included in a return request."""

    __tablename__ = "return_request_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("rti"))
    return_id: Mapped[str] = mapped_column(
        ForeignKey("return_requests.id", ondelete="CASCADE"), index=True, nullable=False
    )
    order_item_id: Mapped[str] = mapped_column(
        ForeignKey("order_items.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)

    return_request: Mapped[ReturnRequest] = relationship(back_populates="items")
    order_item: Mapped[OrderItem] = relationship(lazy="joined")

    __table_args__ = (
        UniqueConstraint(
            "return_id", "order_item_id", name="uq_return_request_items_return_id_order_item_id"
        ),
        CheckConstraint("quantity > 0", name="quantity_positive"),
    )

    def __repr__(self) -> str:
        return f"<ReturnRequestItem {self.id}>"