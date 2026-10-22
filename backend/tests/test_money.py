from __future__ import annotations

from decimal import Decimal

import pytest
from pydantic import TypeAdapter, ValidationError

from app.core.money import (
    MAX_MINOR_UNITS,
    SUPPORTED_CURRENCIES,
    MoneyError,
    format_minor,
    multiply_minor,
    parse_money,
    percent_of,
    refundable_balance,
    to_decimal,
    validate_currency,
)
from app.models.enums import Currency
from app.schemas.common import (
    CustomerComment,
    DecisionNote,
    IdempotencyKeyStr,
    MoneyStr,
    PersonName,
    PositiveMoneyStr,
    ResourceId,
    money,
)


class TestParseMoney:
    @pytest.mark.parametrize(
        ("text", "minor"),
        [
            ("49.99", 4999),
            ("49.9", 4990),
            ("49", 4900),
            ("0.05", 5),
            ("0", 0),
            ("0.00", 0),
            ("1000.00", 100_000),
            ("999999999.99", MAX_MINOR_UNITS),
            ("  12.00 ", 1200),
        ],
    )
    def test_converts_decimal_strings_to_cents(self, text: str, minor: int) -> None:
        assert parse_money(text) == minor

    @pytest.mark.parametrize(
        "text",
        [
            "",
            "abc",
            "1.234",
            "1,000.00",
            ".5",
            "5.",
            "+5",
            "1e3",
            "1 000",
            "--5",
            "5.5.5",
            "$5.00",
            "\u0661\u0662",  # Arabic-Indic digits
            "\uff11\uff12",  # fullwidth digits
        ],
    )
    def test_rejects_malformed_amounts(self, text: str) -> None:
        with pytest.raises(MoneyError, match="Invalid money amount"):
            parse_money(text)

    @pytest.mark.parametrize("value", [49.99, 5, True, None, b"5.00"])
    def test_rejects_floats_ints_and_other_types(self, value: object) -> None:
        with pytest.raises(MoneyError, match="decimal string"):
            parse_money(value)  # type: ignore[arg-type]

    def test_accepts_decimals_with_at_most_two_places(self) -> None:
        assert parse_money(Decimal("49.99")) == 4999
        assert parse_money(Decimal("5")) == 500
        assert parse_money(Decimal("1E+2")) == 10_000

    @pytest.mark.parametrize("value", [Decimal("49.990"), Decimal("NaN"), Decimal("Infinity")])
    def test_rejects_unsafe_decimals(self, value: Decimal) -> None:
        with pytest.raises(MoneyError):
            parse_money(value)

    def test_negative_amounts_need_explicit_permission(self) -> None:
        with pytest.raises(MoneyError, match="cannot be negative"):
            parse_money("-5.00")
        assert parse_money("-5.25", allow_negative=True) == -525

    def test_negative_zero_is_just_zero(self) -> None:
        assert parse_money("-0.00") == 0

    def test_rejects_amounts_above_the_limit(self) -> None:
        with pytest.raises(MoneyError, match="too large"):
            parse_money("1000000000.00")


class TestFormatMinor:
    @pytest.mark.parametrize(
        ("minor", "text"),
        [
            (4999, "49.99"),
            (5, "0.05"),
            (0, "0.00"),
            (100_000, "1000.00"),
            (-525, "-5.25"),
            (MAX_MINOR_UNITS, "999999999.99"),
        ],
    )
    def test_formats_cents_as_decimal_strings(self, minor: int, text: str) -> None:
        assert format_minor(minor) == text

    @pytest.mark.parametrize("value", [True, "5", 5.0, None])
    def test_rejects_non_integers(self, value: object) -> None:
        with pytest.raises(MoneyError, match="must be an int"):
            format_minor(value)  # type: ignore[arg-type]

    @pytest.mark.parametrize("text", ["0.00", "0.01", "12.50", "999999.99"])
    def test_round_trips_with_parse(self, text: str) -> None:
        assert format_minor(parse_money(text)) == text

    def test_to_decimal(self) -> None:
        assert to_decimal(4999) == Decimal("49.99")


class TestCurrency:
    def test_supported_currencies_match_the_enum(self) -> None:
        assert SUPPORTED_CURRENCIES == tuple(currency.value for currency in Currency)

    def test_normalizes_case_and_spaces(self) -> None:
        assert validate_currency(" usd ") == "USD"

    @pytest.mark.parametrize("code", ["JPY", "", "US", "DOLLARS"])
    def test_rejects_unsupported_codes(self, code: str) -> None:
        with pytest.raises(MoneyError, match="Unsupported currency"):
            validate_currency(code)


class TestMultiplyMinor:
    def test_multiplies_by_whole_quantities(self) -> None:
        assert multiply_minor(1250, 2) == 2500
        assert multiply_minor(1999, 3) == 5997
        assert multiply_minor(1999, 0) == 0

    @pytest.mark.parametrize("quantity", [-1, 1.5, True, "2"])
    def test_rejects_invalid_quantities(self, quantity: object) -> None:
        with pytest.raises(MoneyError, match="Quantity"):
            multiply_minor(100, quantity)  # type: ignore[arg-type]

    def test_rejects_overflow(self) -> None:
        with pytest.raises(MoneyError, match="too large"):
            multiply_minor(MAX_MINOR_UNITS, 2)


class TestPercentOf:
    @pytest.mark.parametrize(
        ("minor", "percent", "expected"),
        [
            (10_000, "2.5", 250),
            (10_000, "0", 0),
            (10_000, "100", 10_000),
            (10_000, "33.33", 3333),
            (7999, "10", 800),  # 799.9 rounds up
            (5, "50", 3),  # 2.5 rounds half up
            (1, "50", 1),  # 0.5 rounds half up
            (2, "25", 1),  # 0.5 rounds half up
        ],
    )
    def test_rounds_half_up_to_the_cent(self, minor: int, percent: str, expected: int) -> None:
        assert percent_of(minor, percent) == expected

    def test_accepts_decimal_percentages(self) -> None:
        assert percent_of(10_000, Decimal("2.5")) == 250

    @pytest.mark.parametrize("percent", ["-1", "100.01", "NaN", "Infinity"])
    def test_rejects_out_of_range_percentages(self, percent: str) -> None:
        with pytest.raises(MoneyError, match="between 0 and 100"):
            percent_of(1000, percent)

    def test_rejects_non_numbers(self) -> None:
        with pytest.raises(MoneyError, match="Invalid percentage"):
            percent_of(1000, "abc")


class TestRefundableBalance:
    def test_returns_what_is_left(self) -> None:
        assert refundable_balance(10_499, 0) == 10_499
        assert refundable_balance(6300, 4500) == 1800

    def test_never_goes_below_zero(self) -> None:
        assert refundable_balance(5000, 6000) == 0


class TestMoneySchemaTypes:
    def test_money_string_is_normalized(self) -> None:
        adapter = TypeAdapter(MoneyStr)
        assert adapter.validate_python("49.9") == "49.90"
        assert adapter.validate_python("49") == "49.00"
        assert adapter.validate_python(" 5 ") == "5.00"
        assert adapter.validate_python("0") == "0.00"

    @pytest.mark.parametrize("value", [49.99, 5, None, True, "-1", "1.234", "abc", ""])
    def test_money_string_rejects_numbers_and_bad_text(self, value: object) -> None:
        with pytest.raises(ValidationError):
            TypeAdapter(MoneyStr).validate_python(value)

    def test_positive_money_string(self) -> None:
        adapter = TypeAdapter(PositiveMoneyStr)
        assert adapter.validate_python("0.01") == "0.01"
        for bad in ("0", "0.00", "-1.00", 5.0):
            with pytest.raises(ValidationError):
                adapter.validate_python(bad)

    def test_money_helper_formats_cents(self) -> None:
        assert money(4999) == "49.99"


class TestIdentifierTypes:
    @pytest.mark.parametrize("value", ["ret_3f9a1c0d5b7e2a4c6d8e", "ord_abc123", "usr_a"])
    def test_accepts_generated_style_ids(self, value: str) -> None:
        assert TypeAdapter(ResourceId).validate_python(value) == value

    @pytest.mark.parametrize(
        "value", ["RET_abc", "ret-abc", "ret_", "ret_abc/../x", "ret_" + "a" * 25, "../etc", "", "ret_a b"]
    )
    def test_rejects_other_shapes(self, value: str) -> None:
        with pytest.raises(ValidationError):
            TypeAdapter(ResourceId).validate_python(value)

    @pytest.mark.parametrize(
        "value", ["a" * 16, "123e4567-e89b-12d3-a456-426614174000", "k" * 64, "key_with-dash_1234"]
    )
    def test_idempotency_key_accepts_uuids_and_tokens(self, value: str) -> None:
        assert TypeAdapter(IdempotencyKeyStr).validate_python(value) == value

    @pytest.mark.parametrize("value", ["short", "a" * 65, "has space in it 1234", "slash/1234567890123", ""])
    def test_idempotency_key_rejects_bad_keys(self, value: str) -> None:
        with pytest.raises(ValidationError):
            TypeAdapter(IdempotencyKeyStr).validate_python(value)


class TestTextTypes:
    def test_customer_comment_keeps_newlines_and_tabs(self) -> None:
        assert TypeAdapter(CustomerComment).validate_python("  line one\n\tline two  ") == "line one\n\tline two"

    @pytest.mark.parametrize("value", ["", "   ", "a\x00b", "bell\x07", "x" * 2001])
    def test_customer_comment_rejects_bad_text(self, value: str) -> None:
        with pytest.raises(ValidationError):
            TypeAdapter(CustomerComment).validate_python(value)

    def test_customer_comment_length_limit_is_inclusive(self) -> None:
        assert len(TypeAdapter(CustomerComment).validate_python("x" * 2000)) == 2000

    def test_decision_note_may_be_empty_but_not_long(self) -> None:
        adapter = TypeAdapter(DecisionNote)
        assert adapter.validate_python("  ") == ""
        assert len(adapter.validate_python("n" * 500)) == 500
        with pytest.raises(ValidationError):
            adapter.validate_python("n" * 501)

    def test_person_name_needs_content(self) -> None:
        adapter = TypeAdapter(PersonName)
        assert adapter.validate_python("  Asha ") == "Asha"
        for bad in ("", "   ", "a\x00", "n" * 101):
            with pytest.raises(ValidationError):
                adapter.validate_python(bad)