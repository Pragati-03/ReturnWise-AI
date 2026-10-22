from __future__ import annotations

from datetime import datetime

from app.core.money import refundable_balance
from app.models.enums import Currency, PaymentStatus
from app.models.order import Customer, Order, OrderItem
from app.schemas.common import ResponseModel, money


class CustomerResponse(ResponseModel):
    id: str
    name: str
    email: str

    @classmethod
    def from_model(cls, customer: Customer) -> CustomerResponse:
        return cls(id=customer.id, name=customer.name, email=customer.email)


class OrderItemResponse(ResponseModel):
    id: str
    sku: str
    name: str
    quantity: int
    unit_price: str
    returnable: bool

    @classmethod
    def from_model(cls, item: OrderItem) -> OrderItemResponse:
        return cls(
            id=item.id,
            sku=item.sku,
            name=item.name,
            quantity=item.quantity,
            unit_price=money(item.unit_price_minor),
            returnable=item.returnable,
        )


class OrderResponse(ResponseModel):
    id: str
    order_number: str
    customer: CustomerResponse
    items: list[OrderItemResponse]
    currency: Currency
    total: str
    refunded_amount: str
    # Convenience for the UI; the server always recomputes it and never trusts a client value.
    refundable_amount: str
    payment_status: PaymentStatus
    # Present only after a real PayPal sandbox capture. Never invented.
    paypal_capture_id: str | None
    placed_at: datetime
    delivered_at: datetime | None

    @classmethod
    def from_model(cls, order: Order) -> OrderResponse:
        return cls(
            id=order.id,
            order_number=order.order_number,
            customer=CustomerResponse.from_model(order.customer),
            items=[OrderItemResponse.from_model(item) for item in order.items],
            currency=order.currency,
            total=money(order.total_minor),
            refunded_amount=money(order.refunded_minor),
            refundable_amount=money(refundable_balance(order.total_minor, order.refunded_minor)),
            payment_status=order.payment_status,
            paypal_capture_id=order.paypal_capture_id,
            placed_at=order.placed_at,
            delivered_at=order.delivered_at,
        )