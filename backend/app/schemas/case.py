from __future__ import annotations

import enum
from datetime import datetime

from pydantic import Field, model_validator

from app.models.case import AiAnalysis, PolicyEvaluation, Refund
from app.models.enums import (
    AnalysisSource,
    Currency,
    RefundStatus,
    ReturnReasonCategory,
    SuggestedAction,
)
from app.schemas.common import ResponseModel, money


class PolicyReasonCode(enum.StrEnum):
    """Reason codes produced by the policy engine. Same values as the frontend."""

    WITHIN_RETURN_WINDOW = "WITHIN_RETURN_WINDOW"
    RETURN_WINDOW_EXPIRED = "RETURN_WINDOW_EXPIRED"
    PAYMENT_CAPTURED = "PAYMENT_CAPTURED"
    PAYMENT_NOT_CAPTURED = "PAYMENT_NOT_CAPTURED"
    ITEM_RETURNABLE = "ITEM_RETURNABLE"
    ITEM_NOT_RETURNABLE = "ITEM_NOT_RETURNABLE"
    QUANTITY_VALID = "QUANTITY_VALID"
    QUANTITY_EXCEEDS_ORDERED = "QUANTITY_EXCEEDS_ORDERED"
    AMOUNT_WITHIN_REFUNDABLE = "AMOUNT_WITHIN_REFUNDABLE"
    AMOUNT_EXCEEDS_REFUNDABLE = "AMOUNT_EXCEEDS_REFUNDABLE"
    NO_DUPLICATE_REQUEST = "NO_DUPLICATE_REQUEST"
    DUPLICATE_REQUEST = "DUPLICATE_REQUEST"
    ORDER_NOT_DELIVERED = "ORDER_NOT_DELIVERED"
    PARTIAL_REFUND_NOT_ALLOWED = "PARTIAL_REFUND_NOT_ALLOWED"


class RefundStepStatus(enum.StrEnum):
    COMPLETE = "complete"
    CURRENT = "current"
    UPCOMING = "upcoming"
    FAILED = "failed"


# ---------- Policy evaluation ----------


class PolicyCheckResponse(ResponseModel):
    code: PolicyReasonCode
    label: str
    passed: bool
    detail: str


class PolicyEvaluationResponse(ResponseModel):
    return_id: str
    eligible: bool
    checks: list[PolicyCheckResponse] = Field(min_length=1)
    evaluated_at: datetime

    @model_validator(mode="after")
    def _eligible_matches_checks(self) -> PolicyEvaluationResponse:
        # A record that says "eligible" while a check failed is corrupt. Fail loudly
        # instead of showing the seller a misleading result.
        if self.eligible != all(check.passed for check in self.checks):
            raise ValueError("Evaluation result does not match its checks")
        return self

    @classmethod
    def from_model(cls, evaluation: PolicyEvaluation) -> PolicyEvaluationResponse:
        return cls(
            return_id=evaluation.return_id,
            eligible=evaluation.eligible,
            # Stored JSON is re-validated on the way out, so bad data can't leak through.
            checks=[PolicyCheckResponse.model_validate(item) for item in evaluation.checks],
            evaluated_at=evaluation.evaluated_at,
        )


# ---------- AI analysis ----------


class AiAnalysisResponse(ResponseModel):
    return_id: str
    # "ai" or "fallback". The frontend's "demo" label never comes from the backend.
    source: AnalysisSource
    category: ReturnReasonCategory
    summary: str
    key_points: list[str]
    suggested_action: SuggestedAction
    rationale: str
    # 0 to 1, advisory only. Never used for eligibility or payment decisions.
    confidence: float = Field(ge=0, le=1)
    generated_at: datetime

    @classmethod
    def from_model(cls, analysis: AiAnalysis) -> AiAnalysisResponse:
        return cls(
            return_id=analysis.return_id,
            source=analysis.source,
            category=analysis.category,
            summary=analysis.summary,
            key_points=list(analysis.key_points),
            suggested_action=analysis.suggested_action,
            rationale=analysis.rationale,
            confidence=analysis.confidence_percent / 100,
            generated_at=analysis.generated_at,
        )


# ---------- Refund ----------


class RefundStepResponse(ResponseModel):
    id: str
    title: str
    description: str
    status: RefundStepStatus
    occurred_at: datetime | None


class RefundResponse(ResponseModel):
    return_id: str
    status: RefundStatus
    amount: str
    currency: Currency
    paypal_refund_id: str | None
    failure_reason: str | None
    # Derived by the service from the return status, refund row and audit log, not stored.
    steps: list[RefundStepResponse]

    @model_validator(mode="after")
    def _never_fake_a_payment(self) -> RefundResponse:
        if self.status == RefundStatus.COMPLETED and not self.paypal_refund_id:
            raise ValueError("A completed refund must carry the PayPal refund ID")
        if self.status == RefundStatus.NOT_STARTED and self.paypal_refund_id:
            raise ValueError("A refund that has not started cannot have a PayPal refund ID")
        return self

    @classmethod
    def from_model(cls, refund: Refund, steps: list[RefundStepResponse]) -> RefundResponse:
        return cls(
            return_id=refund.return_id,
            status=refund.status,
            amount=money(refund.amount_minor),
            currency=refund.currency,
            paypal_refund_id=refund.paypal_refund_id,
            failure_reason=refund.failure_reason,
            steps=steps,
        )

    @classmethod
    def not_started(
        cls,
        return_id: str,
        amount_minor: int,
        currency: Currency,
        steps: list[RefundStepResponse],
    ) -> RefundResponse:
        """For a return that has no refund row yet."""
        return cls(
            return_id=return_id,
            status=RefundStatus.NOT_STARTED,
            amount=money(amount_minor),
            currency=currency,
            paypal_refund_id=None,
            failure_reason=None,
            steps=steps,
        )