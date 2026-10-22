from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path, Query, status

from app.api.deps import CurrentUser, DbSession
from app.models.enums import ReturnStatus
from app.schemas.case import PolicyEvaluationResponse
from app.schemas.return_request import (
    ApproveRequest,
    CreateReturnRequest,
    RejectRequest,
    ReturnRequestResponse,
)
from app.services import returns as returns_service
from app.services import workflow
from app.services.errors import NotFoundError

router = APIRouter(prefix="/returns", tags=["returns"])

ReturnIdPath = Annotated[str, Path(min_length=1, max_length=64)]
StatusQuery = Annotated[ReturnStatus | None, Query(alias="status")]


@router.get("", response_model=list[ReturnRequestResponse])
def list_returns(
    user: CurrentUser, db: DbSession, status_filter: StatusQuery = None
) -> list[ReturnRequestResponse]:
    requests = returns_service.list_returns(db, user.id, status_filter)
    return [ReturnRequestResponse.from_model(request) for request in requests]


@router.post("", response_model=ReturnRequestResponse, status_code=status.HTTP_201_CREATED)
def create_return(
    payload: CreateReturnRequest, user: CurrentUser, db: DbSession
) -> ReturnRequestResponse:
    return ReturnRequestResponse.from_model(returns_service.create_return(db, user.id, payload))


@router.get("/{return_id}", response_model=ReturnRequestResponse)
def get_return(return_id: ReturnIdPath, user: CurrentUser, db: DbSession) -> ReturnRequestResponse:
    return ReturnRequestResponse.from_model(returns_service.get_return(db, user.id, return_id))


@router.get("/{return_id}/evaluation", response_model=PolicyEvaluationResponse)
def get_evaluation(
    return_id: ReturnIdPath, user: CurrentUser, db: DbSession
) -> PolicyEvaluationResponse:
    returns_service.get_return(db, user.id, return_id)  # ownership check first
    evaluation = returns_service.latest_evaluation(db, user.id, return_id)
    if evaluation is None:
        raise NotFoundError("No policy evaluation exists for this return yet.")
    return PolicyEvaluationResponse.from_model(evaluation)


@router.post("/{return_id}/start-review", response_model=ReturnRequestResponse)
def start_review(
    return_id: ReturnIdPath, user: CurrentUser, db: DbSession
) -> ReturnRequestResponse:
    return ReturnRequestResponse.from_model(workflow.start_review(db, user.id, return_id))


@router.post("/{return_id}/approve", response_model=ReturnRequestResponse)
def approve_return(
    return_id: ReturnIdPath,
    user: CurrentUser,
    db: DbSession,
    payload: ApproveRequest | None = None,
) -> ReturnRequestResponse:
    note = payload.note if payload is not None else ""
    return ReturnRequestResponse.from_model(workflow.approve_return(db, user.id, return_id, note))


@router.post("/{return_id}/reject", response_model=ReturnRequestResponse)
def reject_return(
    return_id: ReturnIdPath, payload: RejectRequest, user: CurrentUser, db: DbSession
) -> ReturnRequestResponse:
    return ReturnRequestResponse.from_model(
        workflow.reject_return(db, user.id, return_id, payload.note)
    )