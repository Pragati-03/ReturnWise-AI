from __future__ import annotations

from datetime import datetime

from pydantic import Field, field_validator

from app.models.enums import Currency, ReturnStatus
from app.models.return_request import ReturnRequest
from app.schemas.common import (
    CustomerComment,
    DecisionNote,
    PositiveMoneyStr,
    RequestModel,
    ResourceId,
    ResponseModel,
    money,
)
from app.schemas.order import CustomerResponse

MAX_RETURN_LINES = 50
MAX_UNITS_PER_LINE = 1000


class ReturnItemInput(RequestModel):
    order_item_id: ResourceId
    quantity: int = Field(gt=0, le=MAX_UNITS_PER_LINE)


class CreateReturnRequest(RequestModel):
    order_id: ResourceId
    items: list[ReturnItemInput] = Field(min_length=1, max_length=MAX_RETURN_LINES)
    # UNTRUSTED customer text. Never rendered as HTML, and treated as hostile in AI prompts.
    customer_comment: CustomerComment
    requested_amount: PositiveMoneyStr

    @field_validator("items")
    @classmethod
    def _no_duplicate_lines(cls, items: list[ReturnItemInput]) -> list[ReturnItemInput]:
        ids = [item.order_item_id for item in items]
        if len(ids) != len(set(ids)):
            raise ValueError("Each order item may appear only once in a return request")
        return items


class ApproveRequest(RequestModel):
    note: DecisionNote = ""


class RejectRequest(RequestModel):
    # A reason is mandatory when rejecting, so it is recorded with the decision.
    note: DecisionNote

    @field_validator("note")
    @classmethod
    def _note_required(cls, value: str) -> str:
        if not value:
            raise ValueError("A note is required when rejecting a return")
        return value


class ReturnLineItemResponse(ResponseModel):
    order_item_id: str
    quantity: int


class ReturnRequestResponse(ResponseModel):
    id: str
    reference: str
    order_id: str
    customer: CustomerResponse
    status: ReturnStatus
    items: list[ReturnLineItemResponse]
    # Untrusted customer text. Clients must render it as plain text.
    customer_comment: str
    requested_amount: str
    currency: Currency
    submitted_at: datetime
    updated_at: datetime
    decision_note: str | None

    @classmethod
    def from_model(cls, request: ReturnRequest) -> ReturnRequestResponse:
        return cls(
            id=request.id,
            reference=request.reference,
            order_id=request.order_id,
            customer=CustomerResponse.from_model(request.customer),
            status=request.status,
            items=[
                ReturnLineItemResponse(order_item_id=line.order_item_id, quantity=line.quantity)
                for line in request.items
            ],
            customer_comment=request.customer_comment,
            requested_amount=money(request.requested_minor),
            currency=request.currency,
            submitted_at=request.submitted_at,
            updated_at=request.updated_at,
            decision_note=request.decision_note,
        )