from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

# All supported currencies use 2 decimal places (matches the frontend types).
SUPPORTED_CURRENCIES = ("USD", "EUR", "GBP")
MINOR_PER_MAJOR = 100

# 999,999,999.99 in minor units. Fits a 64-bit integer on SQLite and PostgreSQL.
MAX_MINOR_UNITS = 99_999_999_999

_MONEY_PATTERN = re.compile(r"^-?[0-9]+(\.[0-9]{1,2})?$")


class MoneyError(ValueError):
    """Raised for malformed, out-of-range or unsafe money values."""


def parse_money(value: str | Decimal, *, allow_negative: bool = False) -> int:
    """Convert "49.99" (or a Decimal with at most 2 places) to integer minor units.

    Floats and ints are rejected on purpose: floats lose precision, and an int
    would be ambiguous between whole units and cents.
    """
    if isinstance(value, bool) or not isinstance(value, (str, Decimal)):
        raise MoneyError("Money must be a decimal string like '49.99', never a float or int")

    text = format(value, "f") if isinstance(value, Decimal) else value.strip()
    if not _MONEY_PATTERN.fullmatch(text):
        raise MoneyError(f"Invalid money amount: {text!r}")

    negative = text.startswith("-")
    unsigned = text[1:] if negative else text
    whole, _, fraction = unsigned.partition(".")
    minor = int(whole) * MINOR_PER_MAJOR + int(fraction.ljust(2, "0") or "0")

    if minor > MAX_MINOR_UNITS:
        raise MoneyError("Money amount is too large")
    if negative and minor != 0:
        if not allow_negative:
            raise MoneyError("Money amount cannot be negative")
        return -minor
    return minor


def format_minor(minor: int) -> str:
    """Integer minor units to a decimal string: 4999 -> '49.99'."""
    if isinstance(minor, bool) or not isinstance(minor, int):
        raise MoneyError("Minor units must be an int")
    negative = minor < 0
    whole, cents = divmod(abs(minor), MINOR_PER_MAJOR)
    return f"{'-' if negative else ''}{whole}.{cents:02d}"


def to_decimal(minor: int) -> Decimal:
    """For display or logging only. Do arithmetic on the integers."""
    return Decimal(format_minor(minor))


def validate_currency(code: str) -> str:
    normalized = code.strip().upper()
    if normalized not in SUPPORTED_CURRENCIES:
        raise MoneyError(f"Unsupported currency: {code!r}")
    return normalized


def multiply_minor(unit_minor: int, quantity: int) -> int:
    """Unit price times a whole quantity."""
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity < 0:
        raise MoneyError("Quantity must be a non-negative whole number")
    result = unit_minor * quantity
    if abs(result) > MAX_MINOR_UNITS:
        raise MoneyError("Money amount is too large")
    return result


def percent_of(minor: int, percent: str | Decimal) -> int:
    """A percentage of an amount (e.g. a restocking fee), rounded half-up to the cent."""
    try:
        pct = Decimal(percent) if isinstance(percent, str) else percent
    except InvalidOperation as exc:
        raise MoneyError(f"Invalid percentage: {percent!r}") from exc
    if not pct.is_finite() or pct < 0 or pct > 100:
        raise MoneyError("Percentage must be between 0 and 100")
    return int((Decimal(minor) * pct / 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def refundable_balance(total_minor: int, refunded_minor: int) -> int:
    """What is still refundable on an order. Never below zero."""
    return max(0, total_minor - refunded_minor)