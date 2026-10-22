from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.order import Order
from app.services.errors import NotFoundError

MAX_LIMIT = 500


def list_orders(db: Session, seller_id: str, *, limit: int = MAX_LIMIT) -> list[Order]:
    """The seller's orders, newest first. Every query filters by seller_id."""
    limit = max(1, min(limit, MAX_LIMIT))
    statement = (
        select(Order)
        .where(Order.seller_id == seller_id)
        .order_by(Order.placed_at.desc(), Order.id.desc())
        .limit(limit)
    )
    return list(db.scalars(statement))


def get_order(db: Session, seller_id: str, order_id: str) -> Order:
    """One order owned by this seller, or NotFoundError (also for someone else's order)."""
    order = db.scalar(select(Order).where(Order.id == order_id, Order.seller_id == seller_id))
    if order is None:
        raise NotFoundError("Order not found.")
    return order