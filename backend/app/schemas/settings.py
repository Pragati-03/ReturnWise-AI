from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Annotated

from pydantic import BeforeValidator, Field, StrictBool

from app.core.money import parse_money
from app.models.enums import Currency
from app.models.policy import ReturnPolicy
from app.schemas.common import MoneyStr, RequestModel, ResponseModel, money


def _percent_input(value: object) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ValueError("Percentage must be a number")
    try:
        # str() first: Decimal(2.55) would expose the float's binary error, Decimal("2.55") doesn't.
        percent = Decimal(str(value).strip())
    except InvalidOperation as exc:
        raise ValueError("Percentage must be a number") from exc
    if not percent.is_finite():
        raise ValueError("Percentage must be a finite number")
    if percent < 0 or percent > 100:
        raise ValueError("Percentage must be between 0 and 100")
    if percent != percent.quantize(Decimal("0.01")):
        raise ValueError("Percentage may have at most 2 decimal places")
    return percent


PercentDecimal = Annotated[Decimal, BeforeValidator(_percent_input)]
ReturnWindowDays = Annotated[int, Field(strict=True, ge=1, le=365)]


class PolicyUpdateRequest(RequestModel):
    return_window_days: ReturnWindowDays
    require_payment_captured: StrictBool
    allow_partial_refunds: StrictBool
    manual_review_threshold: MoneyStr
    # The frontend sends the whole policy. The service rejects a currency change, because
    # relabeling existing amounts without converting them would be misleading.
    currency: Currency
    restocking_fee_percent: PercentDecimal

    @property
    def manual_review_threshold_minor(self) -> int:
        return parse_money(self.manual_review_threshold)

    @property
    def restocking_fee_bps(self) -> int:
        # Exact: a Decimal with at most 2 places times 100 is a whole number.
        return int(self.restocking_fee_percent * 100)


class PolicyResponse(ResponseModel):
    return_window_days: int
    require_payment_captured: bool
    allow_partial_refunds: bool
    manual_review_threshold: str
    currency: Currency
    restocking_fee_percent: float

    @classmethod
    def from_model(cls, policy: ReturnPolicy) -> PolicyResponse:
        return cls(
            return_window_days=policy.return_window_days,
            require_payment_captured=policy.require_payment_captured,
            allow_partial_refunds=policy.allow_partial_refunds,
            manual_review_threshold=money(policy.manual_review_threshold_minor),
            currency=policy.currency,
            restocking_fee_percent=policy.restocking_fee_bps / 100,
        )