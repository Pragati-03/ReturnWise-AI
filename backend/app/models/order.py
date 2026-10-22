from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.money import multiply_minor, refundable_balance
from app.db.base import Base, TimestampMixin, UTCDateTime, new_id
from app.models.enums import Currency, PaymentStatus, enum_check, str_enum


class Customer(TimestampMixin, Base):
    """A buyer. Not a login account: just a record that belongs to one seller."""

    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("cus"))
    seller_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False)

    __table_args__ = (
        UniqueConstraint("seller_id", "email", name="uq_customers_seller_id_email"),
    )

    def __repr__(self) -> str:
        return f"<Customer {self.id}>"  # no name or email in logs


class Order(TimestampMixin, Base):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("ord"))
    seller_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    customer_id: Mapped[str] = mapped_column(
        ForeignKey("customers.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    order_number: Mapped[str] = mapped_column(String(32), nullable=False)

    currency: Mapped[Currency] = mapped_column(str_enum(Currency, 3), nullable=False)
    # Integer cents. The API converts to and from decimal strings.
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    refunded_minor: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    payment_status: Mapped[PaymentStatus] = mapped_column(
        str_enum(PaymentStatus), default=PaymentStatus.PENDING, nullable=False
    )

    # Filled only by real PayPal sandbox activity (Phase 5). Never invented.
    paypal_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    paypal_capture_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)

    placed_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    delivered_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    # Optimistic locking: an UPDATE that finds a changed version raises
    # StaleDataError instead of silently overwriting. Protects refunded_minor.
    version_id: Mapped[int] = mapped_column(Integer, nullable=False)
    __mapper_args__ = {"version_id_col": version_id}

    customer: Mapped[Customer] = relationship(lazy="joined")
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="OrderItem.sku",
    )

    __table_args__ = (
        UniqueConstraint("seller_id", "order_number", name="uq_orders_seller_id_order_number"),
        # The constraint names below are completed by the naming convention: ck_orders_<name>.
        CheckConstraint("total_minor >= 0", name="total_non_negative"),
        CheckConstraint("refunded_minor >= 0", name="refunded_non_negative"),
        CheckConstraint("refunded_minor <= total_minor", name="refunded_within_total"),
        enum_check("payment_status", PaymentStatus, "payment_status_valid"),
        enum_check("currency", Currency, "currency_valid"),
    )

    @property
    def refundable_minor(self) -> int:
        return refundable_balance(self.total_minor, self.refunded_minor)

    def __repr__(self) -> str:
        return f"<Order {self.id}>"


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("itm"))
    order_id: Mapped[str] = mapped_column(
        ForeignKey("orders.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sku: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # False for final-sale items, which fail the policy check.
    returnable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")

    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("unit_price_minor >= 0", name="unit_price_non_negative"),
    )

    def line_total_minor(self, quantity: int | None = None) -> int:
        return multiply_minor(self.unit_price_minor, self.quantity if quantity is None else quantity)

    def __repr__(self) -> str:
        return f"<OrderItem {self.id}>"