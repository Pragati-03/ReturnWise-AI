from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime

from pydantic import Field

from app.models.audit import AuditLog
from app.models.enums import AuditActorType, AuditEventType, ReturnStatus
from app.schemas.common import RequestModel, ResourceId, ResponseModel

SYSTEM_ACTOR_NAME = "ReturnWise"
AI_ACTOR_NAME = "AI assistant"
UNKNOWN_ACTOR_NAME = "Unknown"


def actor_label(entry: AuditLog, names: Mapping[str, str]) -> str:
    """Display name for an entry's actor.

    The audit table stores IDs only. The service passes a map of user and customer
    IDs to names for just the actors in the current result, so no personal data
    sits in the log itself.
    """
    if entry.actor_type == AuditActorType.SYSTEM:
        return SYSTEM_ACTOR_NAME
    if entry.actor_type == AuditActorType.AI:
        return AI_ACTOR_NAME
    if entry.actor_id is not None:
        return names.get(entry.actor_id, UNKNOWN_ACTOR_NAME)
    return UNKNOWN_ACTOR_NAME


class AuditEntryResponse(ResponseModel):
    id: str
    return_id: str | None
    event_type: AuditEventType
    actor_type: AuditActorType
    actor_name: str
    description: str
    from_status: ReturnStatus | None
    to_status: ReturnStatus | None
    occurred_at: datetime

    @classmethod
    def from_model(cls, entry: AuditLog, actor_name: str) -> AuditEntryResponse:
        return cls(
            id=entry.id,
            return_id=entry.return_id,
            event_type=entry.event_type,
            actor_type=entry.actor_type,
            actor_name=actor_name,
            description=entry.description,
            from_status=entry.from_status,
            to_status=entry.to_status,
            occurred_at=entry.occurred_at,
        )


class AuditFilters(RequestModel):
    """Query parameters for listing audit entries (camelCase on the wire: returnId, eventType...)."""

    return_id: ResourceId | None = None
    event_type: AuditEventType | None = None
    actor_type: AuditActorType | None = None
    # The frontend currently filters and pages on its own, so this is a capped plain list.
    limit: int = Field(default=200, ge=1, le=500)