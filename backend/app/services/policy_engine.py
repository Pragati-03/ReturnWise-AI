from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from app.core.money import percent_of, refundable_balance
from app.models.enums import PaymentStatus
from app.schemas.case import PolicyReasonCode as Code

CURRENCY_SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£"}
REFUNDABLE_PAYMENT_STATUSES = frozenset({PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED})
MAX_NAMES_SHOWN = 3

LABEL_WINDOW = "Within return window"
LABEL_PAYMENT = "Payment captured"
LABEL_RETURNABLE = "Item is returnable"
LABEL_QUANTITY = "Quantity is valid"
LABEL_AMOUNT = "Amount within refundable balance"
LABEL_DUPLICATE = "No duplicate request"


@dataclass(frozen=True, slots=True)
class PolicyLine:
    """One order line included in the return request."""

    order_item_id: str
    name: str
    ordered_quantity: int
    returnable: bool
    unit_price_minor: int
    requested_quantity: int
    # Units of this line already covered by OTHER active (non-rejected) return requests.
    already_requested_quantity: int
    # True if another active request already includes this line.
    has_other_active_request: bool


@dataclass(frozen=True, slots=True)
class PolicyInput:
    """Everything the engine needs. The service builds this from the database."""

    now: datetime
    currency: str
    payment_status: PaymentStatus
    delivered_at: datetime | None
    order_total_minor: int
    order_refunded_minor: int
    lines: tuple[PolicyLine, ...]
    requested_minor: int
    return_window_days: int
    require_payment_captured: bool
    allow_partial_refunds: bool
    manual_review_threshold_minor: int
    restocking_fee_bps: int


@dataclass(frozen=True, slots=True)
class CheckResult:
    code: Code
    label: str
    passed: bool
    detail: str


@dataclass(frozen=True, slots=True)
class PolicyResult:
    checks: tuple[CheckResult, ...]
    eligible: bool
    # Advisory flag only: it never changes eligibility.
    requires_manual_review: bool

    def as_dicts(self) -> list[dict[str, object]]:
        """JSON-ready form for the policy_evaluations.checks column."""
        return [
            {
                "code": check.code.value,
                "label": check.label,
                "passed": check.passed,
                "detail": check.detail,
            }
            for check in self.checks
        ]


# ---------- Helpers ----------


def _money(minor: int, currency: str) -> str:
    symbol = CURRENCY_SYMBOLS.get(currency, "")
    whole, cents = divmod(abs(minor), 100)
    sign = "-" if minor < 0 else ""
    return f"{sign}{symbol}{whole:,}.{cents:02d}"


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def _names(lines: list[PolicyLine]) -> str:
    shown = [line.name for line in lines[:MAX_NAMES_SHOWN]]
    extra = len(lines) - len(shown)
    text = ", ".join(shown)
    return f"{text} and {extra} more" if extra > 0 else text


# ---------- The six checks ----------


def _check_window(data: PolicyInput) -> CheckResult:
    if data.delivered_at is None:
        return CheckResult(
            Code.ORDER_NOT_DELIVERED, LABEL_WINDOW, False, "The order has not been delivered yet."
        )

    elapsed = data.now - data.delivered_at
    if elapsed.total_seconds() < 0:
        return CheckResult(
            Code.ORDER_NOT_DELIVERED,
            LABEL_WINDOW,
            False,
            "The recorded delivery date is in the future.",
        )

    days = elapsed.days
    passed = days <= data.return_window_days
    return CheckResult(
        Code.WITHIN_RETURN_WINDOW if passed else Code.RETURN_WINDOW_EXPIRED,
        LABEL_WINDOW,
        passed,
        f"Delivered {_plural(days, 'day')} ago; policy allows {data.return_window_days} days.",
    )


def _check_payment(data: PolicyInput) -> CheckResult:
    if not data.require_payment_captured:
        return CheckResult(
            Code.PAYMENT_CAPTURED,
            LABEL_PAYMENT,
            True,
            "Not required by your policy. A refund still needs a captured payment.",
        )

    passed = data.payment_status in REFUNDABLE_PAYMENT_STATUSES
    return CheckResult(
        Code.PAYMENT_CAPTURED if passed else Code.PAYMENT_NOT_CAPTURED,
        LABEL_PAYMENT,
        passed,
        f"Payment status is {data.payment_status.value.replace('_', ' ')}.",
    )


def _check_returnable(data: PolicyInput) -> CheckResult:
    if not data.lines:
        return CheckResult(
            Code.ITEM_NOT_RETURNABLE, LABEL_RETURNABLE, False, "No items were selected."
        )

    blocked = [line for line in data.lines if not line.returnable]
    if blocked:
        verb = "is" if len(blocked) == 1 else "are"
        return CheckResult(
            Code.ITEM_NOT_RETURNABLE,
            LABEL_RETURNABLE,
            False,
            f"{_names(blocked)} {verb} marked final sale.",
        )

    detail = (
        f"{data.lines[0].name} is returnable."
        if len(data.lines) == 1
        else f"All {len(data.lines)} items are returnable."
    )
    return CheckResult(Code.ITEM_RETURNABLE, LABEL_RETURNABLE, True, detail)


def _check_quantity(data: PolicyInput) -> CheckResult:
    if not data.lines:
        return CheckResult(
            Code.QUANTITY_EXCEEDS_ORDERED, LABEL_QUANTITY, False, "No items were selected."
        )

    for line in data.lines:
        remaining = max(0, line.ordered_quantity - line.already_requested_quantity)
        if line.requested_quantity < 1:
            return CheckResult(
                Code.QUANTITY_EXCEEDS_ORDERED,
                LABEL_QUANTITY,
                False,
                f"{line.name}: quantity must be at least 1.",
            )
        if line.requested_quantity > remaining:
            return CheckResult(
                Code.QUANTITY_EXCEEDS_ORDERED,
                LABEL_QUANTITY,
                False,
                f"{line.name}: requesting {line.requested_quantity} but only {remaining} of "
                f"{line.ordered_quantity} remain.",
            )

    requested = sum(line.requested_quantity for line in data.lines)
    ordered = sum(line.ordered_quantity for line in data.lines)
    return CheckResult(
        Code.QUANTITY_VALID, LABEL_QUANTITY, True, f"Requesting {requested} of {ordered} ordered."
    )


def _check_amount(data: PolicyInput) -> CheckResult:
    currency = data.currency
    requested = data.requested_minor

    if requested <= 0:
        return CheckResult(
            Code.AMOUNT_EXCEEDS_REFUNDABLE,
            LABEL_AMOUNT,
            False,
            "The requested amount must be greater than zero.",
        )

    items_value = sum(
        line.unit_price_minor * max(0, line.requested_quantity) for line in data.lines
    )
    fee = percent_of(items_value, Decimal(data.restocking_fee_bps) / Decimal(100))
    max_by_items = items_value - fee
    refundable = refundable_balance(data.order_total_minor, data.order_refunded_minor)
    allowed = min(max_by_items, refundable)

    if requested > allowed:
        if requested > refundable:
            reason = f"only {_money(refundable, currency)} remains refundable on the order."
        else:
            reason = f"the returned items are worth {_money(max_by_items, currency)} after fees."
        return CheckResult(
            Code.AMOUNT_EXCEEDS_REFUNDABLE,
            LABEL_AMOUNT,
            False,
            f"{_money(requested, currency)} requested, but {reason}",
        )

    if not data.allow_partial_refunds and requested != allowed:
        return CheckResult(
            Code.PARTIAL_REFUND_NOT_ALLOWED,
            LABEL_AMOUNT,
            False,
            f"Partial refunds are off; the full amount for these items is "
            f"{_money(allowed, currency)}.",
        )

    return CheckResult(
        Code.AMOUNT_WITHIN_REFUNDABLE,
        LABEL_AMOUNT,
        True,
        f"{_money(requested, currency)} requested; {_money(allowed, currency)} refundable "
        "for these items.",
    )


def _check_duplicate(data: PolicyInput) -> CheckResult:
    duplicates = [line for line in data.lines if line.has_other_active_request]
    if duplicates:
        return CheckResult(
            Code.DUPLICATE_REQUEST,
            LABEL_DUPLICATE,
            False,
            f"{_names(duplicates)}: another request already covers this item.",
        )
    return CheckResult(
        Code.NO_DUPLICATE_REQUEST, LABEL_DUPLICATE, True, "No other open request for this item."
    )


# ---------- Entry point ----------


def evaluate_return(data: PolicyInput) -> PolicyResult:
    """Run all six checks. Eligible only if every one passes.

    Pure and deterministic: no database, clock or AI. AI may comment on a case but can
    never change this result.
    """
    if data.now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    if data.delivered_at is not None and data.delivered_at.tzinfo is None:
        raise ValueError("delivered_at must be timezone-aware")

    checks = (
        _check_window(data),
        _check_payment(data),
        _check_returnable(data),
        _check_quantity(data),
        _check_amount(data),
        _check_duplicate(data),
    )
    return PolicyResult(
        checks=checks,
        eligible=all(check.passed for check in checks),
        requires_manual_review=data.requested_minor > data.manual_review_threshold_minor,
    )