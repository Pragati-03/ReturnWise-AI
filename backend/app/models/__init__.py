"""SQLAlchemy models.

Importing this package registers every table on Base.metadata, which is what
Alembic and the test fixtures rely on.
"""

from app.models.audit import AuditLog
from app.models.case import AiAnalysis, PolicyEvaluation, Refund
from app.models.order import Customer, Order, OrderItem
from app.models.payments import IdempotencyKey, PaypalWebhookEvent
from app.models.policy import ReturnPolicy
from app.models.return_request import ReturnRequest, ReturnRequestItem
from app.models.user import User

__all__ = [
    "AiAnalysis",
    "AuditLog",
    "Customer",
    "IdempotencyKey",
    "Order",
    "OrderItem",
    "PaypalWebhookEvent",
    "PolicyEvaluation",
    "Refund",
    "ReturnPolicy",
    "ReturnRequest",
    "ReturnRequestItem",
    "User",
]