from __future__ import annotations

from pydantic import Field, model_validator

from app.models.enums import Currency, ReturnStatus
from app.schemas.common import ResponseModel


def empty_status_counts() -> dict[ReturnStatus, int]:
    """A zero for every status. The metrics service starts from this and fills in counts."""
    return {status: 0 for status in ReturnStatus}


class DashboardMetricsResponse(ResponseModel):
    open_returns: int = Field(ge=0)
    awaiting_review: int = Field(ge=0)
    refunds_pending: int = Field(ge=0)
    # Decimal string. Only refunds that PayPal has confirmed (completed) are counted.
    refunded_this_month: str
    currency: Currency
    # Average hours from submission to the first approve or reject decision.
    avg_decision_hours: float = Field(ge=0)
    returns_by_status: dict[ReturnStatus, int]

    @model_validator(mode="after")
    def _all_statuses_present(self) -> DashboardMetricsResponse:
        missing = set(ReturnStatus) - set(self.returns_by_status)
        if missing:
            names = ", ".join(sorted(status.value for status in missing))
            raise ValueError(f"returnsByStatus is missing statuses: {names}")
        if any(count < 0 for count in self.returns_by_status.values()):
            raise ValueError("Counts cannot be negative")
        return self