from __future__ import annotations

import re
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    StringConstraints,
)
from pydantic.alias_generators import to_camel

from app.core.money import MoneyError, format_minor, parse_money

# ---------- Base classes ----------


class RequestModel(BaseModel):
    """Base for request bodies: strict, camelCase, no unknown fields."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",  # unknown fields are errors, not silently ignored
        str_strip_whitespace=True,
    )


class ResponseModel(BaseModel):
    """Base for responses: camelCase on the wire (matches the frontend types).

    FastAPI serializes by alias by default, so Python code keeps snake_case
    while JSON uses camelCase.
    """

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


# ---------- Money ----------


def _money_input(value: object) -> str:
    # JSON numbers (floats) are rejected: they lose precision and can't be trusted for money.
    if not isinstance(value, str):
        raise ValueError("Money must be a decimal string such as '49.99', not a number")
    try:
        # Normalize "49.9" -> "49.90" so downstream code sees one canonical form.
        return format_minor(parse_money(value))
    except MoneyError as exc:
        raise ValueError(str(exc)) from exc


def _positive(value: str) -> str:
    if parse_money(value) <= 0:
        raise ValueError("Amount must be greater than zero")
    return value


MoneyStr = Annotated[str, BeforeValidator(_money_input)]
"""Zero or more, at most 2 decimals, never negative. Use for amounts that may be 0.00."""

PositiveMoneyStr = Annotated[str, BeforeValidator(_money_input), AfterValidator(_positive)]
"""Strictly greater than zero. Use for requested and refund amounts."""


def money(minor: int) -> str:
    """Response helper: integer cents (database) to a decimal string (API)."""
    return format_minor(minor)


# ---------- Text ----------

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")  # keeps \t, \n, \r


def _reject_control_chars(value: str) -> str:
    if _CONTROL_CHARS.search(value):
        raise ValueError("Text contains unsupported control characters")
    return value


CustomerComment = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=2000),
    AfterValidator(_reject_control_chars),
]
"""UNTRUSTED customer text. Always treated as plain text, and as hostile input in AI prompts."""

DecisionNote = Annotated[
    str,
    StringConstraints(strip_whitespace=True, max_length=500),
    AfterValidator(_reject_control_chars),
]
"""Seller note on a decision. May be empty; the service decides whether it is required."""

PersonName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(_reject_control_chars),
]

# ---------- Identifiers ----------

ID_PATTERN = r"^[a-z]{3}_[a-z0-9]{1,24}$"
"""Matches IDs from new_id(), e.g. 'ret_3f9a1c0d5b7e2a4c6d8e'."""

ResourceId = Annotated[str, StringConstraints(pattern=ID_PATTERN, max_length=32)]

IDEMPOTENCY_KEY_PATTERN = r"^[A-Za-z0-9_-]{16,64}$"
"""A UUID (with or without dashes) fits. Clients generate one key per intended action."""

IdempotencyKeyStr = Annotated[str, StringConstraints(pattern=IDEMPOTENCY_KEY_PATTERN)]