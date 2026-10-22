from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path

from app.api.deps import CurrentUser, DbSession
from app.schemas.order import OrderResponse
from app.services import orders as order_service

router = APIRouter(prefix="/orders", tags=["orders"])

# Loose on purpose: an unknown or malformed ID should be a clean 404, not a 422.
OrderIdPath = Annotated[str, Path(min_length=1, max_length=64)]


@router.get("", response_model=list[OrderResponse])
def list_orders(user: CurrentUser, db: DbSession) -> list[OrderResponse]:
    return [OrderResponse.from_model(order) for order in order_service.list_orders(db, user.id)]


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(order_id: OrderIdPath, user: CurrentUser, db: DbSession) -> OrderResponse:
    return OrderResponse.from_model(order_service.get_order(db, user.id, order_id))