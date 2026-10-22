from __future__ import annotations

import enum

from sqlalchemy import CheckConstraint
from sqlalchemy import Enum as SAEnum

from app.core.money import SUPPORTED_CURRENCIES


class Currency(enum.StrEnum):
    USD = "USD"
    EUR = "EUR"
    GBP = "GBP"


class PaymentStatus(enum.StrEnum):
    PENDING = "pending"
    CAPTURED = "captured"
    PARTIALLY_REFUNDED = "partially_refunded"
    REFUNDED = "refunded"
    FAILED = "failed"


class ReturnStatus(enum.StrEnum):
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    REJECTED = "rejected"
    REFUND_PENDING = "refund_pending"
    REFUNDED = "refunded"
    REFUND_FAILED = "refund_failed"


class ReturnReasonCategory(enum.StrEnum):
    DAMAGED = "damaged"
    WRONG_ITEM = "wrong_item"
    NOT_AS_DESCRIBED = "not_as_described"
    SIZE_FIT = "size_fit"
    CHANGED_MIND = "changed_mind"
    LATE_DELIVERY = "late_delivery"
    OTHER = "other"


class SuggestedAction(enum.StrEnum):
    APPROVE = "approve"
    REJECT = "reject"
    REQUEST_MORE_INFO = "request_more_info"
    MANUAL_REVIEW = "manual_review"


class AnalysisSource(enum.StrEnum):
    AI = "ai"
    FALLBACK = "fallback"


class RefundStatus(enum.StrEnum):
    NOT_STARTED = "not_started"
    PENDING = "pending"
    COMPLETED = "completed"
    FAILED = "failed"


class AuditEventType(enum.StrEnum):
    RETURN_SUBMITTED = "return_submitted"
    POLICY_EVALUATED = "policy_evaluated"
    AI_ANALYSIS_GENERATED = "ai_analysis_generated"
    REVIEW_STARTED = "review_started"
    RETURN_APPROVED = "return_approved"
    RETURN_REJECTED = "return_rejected"
    REFUND_INITIATED = "refund_initiated"
    REFUND_COMPLETED = "refund_completed"
    REFUND_FAILED = "refund_failed"
    POLICY_UPDATED = "policy_updated"


class AuditActorType(enum.StrEnum):
    CUSTOMER = "customer"
    SELLER = "seller"
    SYSTEM = "system"
    AI = "ai"


# Keep the enum and the money module in agreement. Fails at import, not in production.
assert tuple(currency.value for currency in Currency) == SUPPORTED_CURRENCIES


def str_enum(enum_cls: type[enum.Enum], length: int = 32) -> SAEnum:
    """Store the enum's VALUES (e.g. 'under_review') as plain text.

    Plain text works the same on SQLite and PostgreSQL and avoids native enum
    types, which are painful to migrate. validate_strings rejects unknown values
    before they reach the database.
    """
    return SAEnum(
        enum_cls,
        native_enum=False,
        length=length,
        create_constraint=False,
        validate_strings=True,
        values_callable=lambda cls: [member.value for member in cls],
    )


def enum_check(column: str, enum_cls: type[enum.Enum], name: str) -> CheckConstraint:
    """DB-level guard: rejects values outside the enum even for raw SQL writes.

    The final constraint name becomes ck_<table>_<name> via the naming convention.
    """
    values = ", ".join(f"'{member.value}'" for member in enum_cls)
    return CheckConstraint(f"{column} IN ({values})", name=name)