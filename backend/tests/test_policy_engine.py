from __future__ import annotations

import json
from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone

import pytest

from app.models.enums import PaymentStatus
from app.schemas.case import PolicyCheckResponse
from app.schemas.case import PolicyReasonCode as Code
from app.services.policy_engine import PolicyInput, PolicyLine, PolicyResult, evaluate_return

NOW = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)

# Positions of the six checks in a result.
WINDOW, PAYMENT, RETURNABLE, QUANTITY, AMOUNT, DUPLICATE = range(6)


def line(**over: object) -> PolicyLine:
    base: dict[str, object] = dict(
        order_item_id="itm_a",
        name="Earbuds",
        ordered_quantity=1,
        returnable=True,
        unit_price_minor=7999,
        requested_quantity=1,
        already_requested_quantity=0,
        has_other_active_request=False,
    )
    base.update(over)
    return PolicyLine(**base)  # type: ignore[arg-type]


def make(**over: object) -> PolicyInput:
    base: dict[str, object] = dict(
        now=NOW,
        currency="USD",
        payment_status=PaymentStatus.CAPTURED,
        delivered_at=NOW - timedelta(days=9),
        order_total_minor=10_499,
        order_refunded_minor=0,
        lines=(line(),),
        requested_minor=7999,
        return_window_days=30,
        require_payment_captured=True,
        allow_partial_refunds=True,
        manual_review_threshold_minor=15_000,
        restocking_fee_bps=0,
    )
    base.update(over)
    return PolicyInput(**base)  # type: ignore[arg-type]


def evaluate(**over: object) -> PolicyResult:
    return evaluate_return(make(**over))


class TestBaseline:
    def test_a_clean_request_passes_all_six_checks_in_order(self) -> None:
        result = evaluate()
        assert result.eligible is True
        assert [c.code for c in result.checks] == [
            Code.WITHIN_RETURN_WINDOW,
            Code.PAYMENT_CAPTURED,
            Code.ITEM_RETURNABLE,
            Code.QUANTITY_VALID,
            Code.AMOUNT_WITHIN_REFUNDABLE,
            Code.NO_DUPLICATE_REQUEST,
        ]
        assert all(c.passed for c in result.checks)
        assert result.requires_manual_review is False

    def test_the_result_is_deterministic(self) -> None:
        assert evaluate() == evaluate()

    def test_results_are_immutable(self) -> None:
        result = evaluate()
        with pytest.raises(FrozenInstanceError):
            result.eligible = False  # type: ignore[misc]

    def test_naive_datetimes_are_refused(self) -> None:
        with pytest.raises(ValueError, match="timezone-aware"):
            evaluate(now=datetime(2026, 10, 12, 9, 0))
        with pytest.raises(ValueError, match="timezone-aware"):
            evaluate(delivered_at=datetime(2026, 10, 3, 9, 0))


class TestReturnWindow:
    @pytest.mark.parametrize(
        ("ago", "passes"),
        [
            (timedelta(0), True),
            (timedelta(days=30), True),
            (timedelta(days=30, hours=23), True),  # whole days are counted
            (timedelta(days=31), False),
            (timedelta(days=51), False),
        ],
    )
    def test_boundaries(self, ago: timedelta, passes: bool) -> None:
        check = evaluate(delivered_at=NOW - ago).checks[WINDOW]
        assert check.passed is passes
        assert check.code == (Code.WITHIN_RETURN_WINDOW if passes else Code.RETURN_WINDOW_EXPIRED)

    def test_detail_text(self) -> None:
        assert evaluate().checks[WINDOW].detail == "Delivered 9 days ago; policy allows 30 days."
        assert (
            evaluate(delivered_at=NOW - timedelta(days=1)).checks[WINDOW].detail
            == "Delivered 1 day ago; policy allows 30 days."
        )

    def test_the_window_comes_from_the_policy(self) -> None:
        assert evaluate(return_window_days=7).checks[WINDOW].passed is False
        assert evaluate(return_window_days=9).checks[WINDOW].passed is True

    def test_an_undelivered_order_fails(self) -> None:
        check = evaluate(delivered_at=None).checks[WINDOW]
        assert check.passed is False
        assert check.code == Code.ORDER_NOT_DELIVERED

    def test_a_delivery_date_in_the_future_fails(self) -> None:
        check = evaluate(delivered_at=NOW + timedelta(days=1)).checks[WINDOW]
        assert check.passed is False
        assert check.code == Code.ORDER_NOT_DELIVERED


class TestPayment:
    @pytest.mark.parametrize(
        "status", [PaymentStatus.CAPTURED, PaymentStatus.PARTIALLY_REFUNDED]
    )
    def test_refundable_statuses_pass(self, status: PaymentStatus) -> None:
        assert evaluate(payment_status=status).checks[PAYMENT].passed is True

    @pytest.mark.parametrize(
        "status", [PaymentStatus.PENDING, PaymentStatus.FAILED, PaymentStatus.REFUNDED]
    )
    def test_other_statuses_fail(self, status: PaymentStatus) -> None:
        check = evaluate(payment_status=status).checks[PAYMENT]
        assert check.passed is False
        assert check.code == Code.PAYMENT_NOT_CAPTURED

    def test_detail_names_the_status(self) -> None:
        check = evaluate(payment_status=PaymentStatus.PARTIALLY_REFUNDED).checks[PAYMENT]
        assert check.detail == "Payment status is partially refunded."

    def test_the_requirement_can_be_switched_off_but_says_a_refund_still_needs_it(self) -> None:
        check = evaluate(
            payment_status=PaymentStatus.PENDING, require_payment_captured=False
        ).checks[PAYMENT]
        assert check.passed is True
        assert "still needs a captured payment" in check.detail


class TestReturnableItems:
    def test_final_sale_items_fail(self) -> None:
        check = evaluate(lines=(line(returnable=False),)).checks[RETURNABLE]
        assert check.passed is False
        assert check.code == Code.ITEM_NOT_RETURNABLE
        assert check.detail == "Earbuds is marked final sale."

    def test_one_blocked_line_among_several_fails_the_request(self) -> None:
        lines = (line(order_item_id="itm_a"), line(order_item_id="itm_b", name="Watch", returnable=False))
        check = evaluate(lines=lines).checks[RETURNABLE]
        assert check.passed is False
        assert check.detail == "Watch is marked final sale."

    def test_blocked_names_are_shortened_after_three(self) -> None:
        lines = tuple(
            line(order_item_id=f"itm_{n}", name=name, returnable=False)
            for n, name in enumerate(["A", "B", "C", "D", "E"])
        )
        assert evaluate(lines=lines).checks[RETURNABLE].detail == "A, B, C and 2 more are marked final sale."

    def test_passing_details(self) -> None:
        assert evaluate().checks[RETURNABLE].detail == "Earbuds is returnable."
        two = (line(order_item_id="itm_a"), line(order_item_id="itm_b", name="Cable"))
        assert evaluate(lines=two).checks[RETURNABLE].detail == "All 2 items are returnable."

    def test_an_empty_selection_fails_closed(self) -> None:
        result = evaluate(lines=())
        assert result.eligible is False
        assert result.checks[RETURNABLE].detail == "No items were selected."
        assert result.checks[QUANTITY].detail == "No items were selected."


class TestQuantity:
    def test_requesting_more_than_remains_fails(self) -> None:
        check = evaluate(lines=(line(ordered_quantity=2, already_requested_quantity=1, requested_quantity=2),)).checks[QUANTITY]
        assert check.passed is False
        assert check.code == Code.QUANTITY_EXCEEDS_ORDERED
        assert "only 1 of 2 remain" in check.detail

    def test_nothing_remaining_fails(self) -> None:
        check = evaluate(lines=(line(already_requested_quantity=1),)).checks[QUANTITY]
        assert check.passed is False
        assert "only 0 of 1 remain" in check.detail

    def test_zero_quantity_fails(self) -> None:
        check = evaluate(lines=(line(requested_quantity=0),)).checks[QUANTITY]
        assert check.passed is False
        assert "at least 1" in check.detail

    def test_the_remaining_units_can_be_requested(self) -> None:
        check = evaluate(lines=(line(ordered_quantity=2, already_requested_quantity=1, requested_quantity=1),)).checks[QUANTITY]
        assert check.passed is True
        assert check.detail == "Requesting 1 of 2 ordered."


class TestAmount:
    def test_exact_amount_passes(self) -> None:
        check = evaluate().checks[AMOUNT]
        assert check.code == Code.AMOUNT_WITHIN_REFUNDABLE
        assert "refundable for these items" in check.detail

    def test_less_than_the_items_are_worth_passes_when_partial_refunds_are_allowed(self) -> None:
        assert evaluate(requested_minor=5000).checks[AMOUNT].passed is True

    def test_more_than_the_items_are_worth_fails(self) -> None:
        check = evaluate(requested_minor=9000).checks[AMOUNT]
        assert check.passed is False
        assert check.code == Code.AMOUNT_EXCEEDS_REFUNDABLE
        assert check.detail == "$90.00 requested, but the returned items are worth $79.99 after fees."

    def test_more_than_the_order_has_left_fails(self) -> None:
        check = evaluate(order_refunded_minor=10_000).checks[AMOUNT]
        assert check.passed is False
        assert check.detail == "$79.99 requested, but only $4.99 remains refundable on the order."

    def test_zero_amount_fails(self) -> None:
        check = evaluate(requested_minor=0).checks[AMOUNT]
        assert check.passed is False
        assert "greater than zero" in check.detail

    def test_multiple_units_are_valued_together(self) -> None:
        lines = (line(name="Cable", ordered_quantity=2, unit_price_minor=1250, requested_quantity=2),)
        assert evaluate(lines=lines, requested_minor=2500).checks[AMOUNT].passed is True
        assert evaluate(lines=lines, requested_minor=2501).checks[AMOUNT].passed is False

    def test_partial_refunds_can_be_switched_off(self) -> None:
        partial = evaluate(allow_partial_refunds=False, requested_minor=5000).checks[AMOUNT]
        assert partial.passed is False
        assert partial.code == Code.PARTIAL_REFUND_NOT_ALLOWED
        assert "Partial refunds are off" in partial.detail
        assert evaluate(allow_partial_refunds=False, requested_minor=7999).checks[AMOUNT].passed is True

    def test_restocking_fee_reduces_the_most_that_can_be_refunded(self) -> None:
        # 10% of $79.99 is $8.00 (rounded half up), so $71.99 is the most.
        assert evaluate(restocking_fee_bps=1000, requested_minor=7199).checks[AMOUNT].passed is True
        assert evaluate(restocking_fee_bps=1000, requested_minor=7200).checks[AMOUNT].passed is False
        assert (
            evaluate(restocking_fee_bps=1000, allow_partial_refunds=False, requested_minor=7199)
            .checks[AMOUNT]
            .passed
            is True
        )

    @pytest.mark.parametrize(("currency", "symbol"), [("USD", "$"), ("EUR", "€"), ("GBP", "£")])
    def test_amounts_use_the_order_currency_symbol(self, currency: str, symbol: str) -> None:
        check = evaluate(currency=currency, requested_minor=9000).checks[AMOUNT]
        assert f"worth {symbol}79.99" in check.detail

    def test_large_amounts_get_thousands_separators(self) -> None:
        lines = (line(unit_price_minor=300_000),)
        check = evaluate(lines=lines, order_total_minor=300_000, requested_minor=400_000).checks[AMOUNT]
        assert "only $3,000.00 remains refundable" in check.detail


class TestDuplicates:
    def test_another_open_request_fails(self) -> None:
        check = evaluate(lines=(line(has_other_active_request=True),)).checks[DUPLICATE]
        assert check.passed is False
        assert check.code == Code.DUPLICATE_REQUEST
        assert check.detail == "Earbuds: another request already covers this item."

    def test_no_other_request_passes(self) -> None:
        assert evaluate().checks[DUPLICATE].detail == "No other open request for this item."


class TestEligibility:
    SINGLE_FAILURES = [
        ("window", WINDOW, {"delivered_at": NOW - timedelta(days=51)}),
        ("payment", PAYMENT, {"payment_status": PaymentStatus.PENDING}),
        ("returnable", RETURNABLE, {"lines": (line(returnable=False),)}),
        ("quantity", QUANTITY, {"lines": (line(requested_quantity=2),)}),
        ("amount", AMOUNT, {"requested_minor": 9000}),
        ("duplicate", DUPLICATE, {"lines": (line(has_other_active_request=True),)}),
    ]

    @pytest.mark.parametrize(("_name", "index", "override"), SINGLE_FAILURES, ids=[f[0] for f in SINGLE_FAILURES])
    def test_any_single_failed_check_makes_the_request_ineligible(
        self, _name: str, index: int, override: dict[str, object]
    ) -> None:
        result = evaluate(**override)
        failed = [i for i, check in enumerate(result.checks) if not check.passed]
        assert failed == [index]
        assert result.eligible is False

    def test_several_failures_are_all_reported(self) -> None:
        result = evaluate(
            delivered_at=NOW - timedelta(days=51), lines=(line(returnable=False),)
        )
        failed = [check.code for check in result.checks if not check.passed]
        assert failed == [Code.RETURN_WINDOW_EXPIRED, Code.ITEM_NOT_RETURNABLE]


class TestManualReviewFlag:
    def test_it_is_set_above_the_threshold_and_not_at_it(self) -> None:
        assert evaluate(manual_review_threshold_minor=7998).requires_manual_review is True
        assert evaluate(manual_review_threshold_minor=7999).requires_manual_review is False

    def test_it_never_changes_eligibility(self) -> None:
        flagged = evaluate(manual_review_threshold_minor=5000)
        assert flagged.requires_manual_review is True
        assert flagged.eligible is True

    def test_it_is_independent_of_whether_the_request_passes(self) -> None:
        result = evaluate(requested_minor=15_001)
        assert result.requires_manual_review is True
        assert result.eligible is False  # the amount check fails on its own


class TestStorageFormat:
    def test_as_dicts_is_json_ready_and_matches_the_response_schema(self) -> None:
        dicts = evaluate().as_dicts()
        assert len(dicts) == 6
        assert json.loads(json.dumps(dicts)) == dicts
        for item in dicts:
            assert set(item) == {"code", "label", "passed", "detail"}
            assert isinstance(item["code"], str)
            PolicyCheckResponse.model_validate(item)