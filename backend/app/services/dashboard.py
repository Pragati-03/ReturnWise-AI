from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.money import format_minor
from app.db.base import utcnow
from app.models.case import Refund
from app.models.enums import Currency, RefundStatus, ReturnStatus
from app.models.policy import ReturnPolicy
from app.models.return_request import ReturnRequest
from app.schemas.dashboard import DashboardMetricsResponse, empty_status_counts

SECONDS_PER_HOUR = 3600


def _month_bounds(moment: datetime) -> tuple[datetime, datetime]:
    start = datetime(moment.year, moment.month, 1, tzinfo=timezone.utc)
    if moment.month == 12:
        end = datetime(moment.year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(moment.year, moment.month + 1, 1, tzinfo=timezone.utc)
    return start, end


def get_metrics(
    db: Session, seller_id: str, *, now: datetime | None = None
) -> DashboardMetricsResponse:
    moment = now or utcnow()
    if moment.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    moment = moment.astimezone(timezone.utc)

    # Counts per status. Every status is present, even at zero.
    counts = empty_status_counts()
    for status, total in db.execute(
        select(ReturnRequest.status, func.count())
        .where(ReturnRequest.seller_id == seller_id)
        .group_by(ReturnRequest.status)
    ):
        counts[status] = int(total)

    currency = (
        db.scalar(select(ReturnPolicy.currency).where(ReturnPolicy.seller_id == seller_id))
        or Currency.USD
    )

    # Only refunds PayPal confirmed count as refunded money.
    month_start, month_end = _month_bounds(moment)
    refunded_minor = db.scalar(
        select(func.coalesce(func.sum(Refund.amount_minor), 0)).where(
            Refund.seller_id == seller_id,
            Refund.status == RefundStatus.COMPLETED,
            Refund.currency == currency,
            Refund.completed_at >= month_start,
            Refund.completed_at < month_end,
        )
    )

    # Average hours from submission to the approve/reject decision.
    hours = [
        max(0.0, (decided - submitted).total_seconds() / SECONDS_PER_HOUR)
        for submitted, decided in db.execute(
            select(ReturnRequest.submitted_at, ReturnRequest.decided_at).where(
                ReturnRequest.seller_id == seller_id, ReturnRequest.decided_at.is_not(None)
            )
        )
    ]
    avg_hours = round(sum(hours) / len(hours), 1) if hours else 0.0

    return DashboardMetricsResponse(
        # Open = not yet rejected or refunded (a failed refund still needs attention).
        open_returns=sum(counts.values()) - counts[ReturnStatus.REJECTED] - counts[ReturnStatus.REFUNDED],
        awaiting_review=counts[ReturnStatus.SUBMITTED] + counts[ReturnStatus.UNDER_REVIEW],
        refunds_pending=counts[ReturnStatus.REFUND_PENDING],
        refunded_this_month=format_minor(int(refunded_minor or 0)),
        currency=currency,
        avg_decision_hours=avg_hours,
        returns_by_status=counts,
    )