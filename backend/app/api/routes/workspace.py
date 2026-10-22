from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.models.enums import AuditActorType, AuditEventType
from app.schemas.audit import AuditEntryResponse, AuditFilters
from app.schemas.common import ID_PATTERN
from app.schemas.dashboard import DashboardMetricsResponse
from app.schemas.settings import PolicyResponse, PolicyUpdateRequest
from app.services import audit as audit_service
from app.services import dashboard as dashboard_service
from app.services import settings as settings_service

router = APIRouter(tags=["workspace"])

# Validated here (not just in AuditFilters), so a bad value is a clean 422 and never a crash.
ReturnIdQuery = Annotated[
    str | None, Query(alias="returnId", pattern=ID_PATTERN, max_length=32)
]
EventTypeQuery = Annotated[AuditEventType | None, Query(alias="eventType")]
ActorTypeQuery = Annotated[AuditActorType | None, Query(alias="actorType")]
LimitQuery = Annotated[int, Query(ge=1, le=500)]


@router.get("/policy", response_model=PolicyResponse)
def get_policy(user: CurrentUser, db: DbSession) -> PolicyResponse:
    return PolicyResponse.from_model(settings_service.get_policy(db, user.id))


@router.put("/policy", response_model=PolicyResponse)
def update_policy(
    payload: PolicyUpdateRequest, user: CurrentUser, db: DbSession
) -> PolicyResponse:
    return PolicyResponse.from_model(settings_service.update_policy(db, user.id, payload))


@router.get("/audit", response_model=list[AuditEntryResponse])
def list_audit(
    user: CurrentUser,
    db: DbSession,
    return_id: ReturnIdQuery = None,
    event_type: EventTypeQuery = None,
    actor_type: ActorTypeQuery = None,
    limit: LimitQuery = 200,
) -> list[AuditEntryResponse]:
    filters = AuditFilters(
        return_id=return_id, event_type=event_type, actor_type=actor_type, limit=limit
    )
    return audit_service.list_audit_entries(db, user.id, filters)


@router.get("/dashboard/metrics", response_model=DashboardMetricsResponse)
def get_metrics(user: CurrentUser, db: DbSession) -> DashboardMetricsResponse:
    return dashboard_service.get_metrics(db, user.id)