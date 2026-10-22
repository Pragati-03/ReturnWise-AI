from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models import Order, Refund, ReturnRequest, User
from app.models.enums import Currency, RefundStatus, ReturnStatus

API = "/api/v1"
MISSING = object()  # marks a field to leave out of a request body

STATUSES = [
    "submitted",
    "under_review",
    "approved",
    "rejected",
    "refund_pending",
    "refunded",
    "refund_failed",
]
DEFAULT_POLICY = {
    "returnWindowDays": 30,
    "requirePaymentCaptured": True,
    "allowPartialRefunds": True,
    "manualReviewThreshold": "150.00",
    "currency": "USD",
    "restockingFeePercent": 0,
}


# ---------- fixtures and helpers ----------


@pytest.fixture
def seller(make_seller: Callable[..., User]) -> User:
    return make_seller("asha@example.com", "Asha")


@pytest.fixture
def headers(seller: User, login_headers: Callable[..., dict[str, str]]) -> dict[str, str]:
    return login_headers("asha@example.com")


@pytest.fixture
def order(seller: User, make_order: Callable[..., Order]) -> Order:
    return make_order(seller)  # earbuds and cables, captured, delivered 9 days ago


def policy_body(**over: Any) -> dict[str, Any]:
    body = dict(DEFAULT_POLICY)
    for key, value in over.items():
        if value is MISSING:
            body.pop(key)
        else:
            body[key] = value
    return body


def item_id(order: Order, sku: str) -> str:
    return next(item.id for item in order.items if item.sku == sku)


def file_return(
    client: TestClient,
    headers: dict[str, str],
    order: Order,
    sku: str = "EARBUDS",
    amount: str = "79.99",
    comment: str = "It stopped working.",
) -> str:
    response = client.post(
        f"{API}/returns",
        headers=headers,
        json={
            "orderId": order.id,
            "items": [{"orderItemId": item_id(order, sku), "quantity": 1}],
            "customerComment": comment,
            "requestedAmount": amount,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def evaluation(client: TestClient, headers: dict[str, str], return_id: str) -> dict[str, Any]:
    response = client.get(f"{API}/returns/{return_id}/evaluation", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def failed_codes(result: dict[str, Any]) -> list[str]:
    return [check["code"] for check in result["checks"] if not check["passed"]]


def put_policy(client: TestClient, headers: dict[str, str], **over: Any):
    return client.put(f"{API}/policy", headers=headers, json=policy_body(**over))


def audit(client: TestClient, headers: dict[str, str], **params: Any) -> list[dict[str, Any]]:
    response = client.get(f"{API}/audit", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def metrics(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    response = client.get(f"{API}/dashboard/metrics", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def decide(client: TestClient, headers: dict[str, str], return_id: str, outcome: str) -> None:
    assert client.post(f"{API}/returns/{return_id}/start-review", headers=headers).status_code == 200
    body = {"note": "Looks good" if outcome == "approve" else "Not covered"}
    assert client.post(f"{API}/returns/{return_id}/{outcome}", headers=headers, json=body).status_code == 200


# ---------- policy ----------


class TestPolicy:
    def test_a_new_seller_has_the_default_policy(self, client: TestClient, headers: dict[str, str]) -> None:
        response = client.get(f"{API}/policy", headers=headers)
        assert response.status_code == 200
        assert response.json() == DEFAULT_POLICY

    def test_a_full_update_is_saved_and_normalized(
        self, client: TestClient, headers: dict[str, str]
    ) -> None:
        body = policy_body(
            returnWindowDays=14,
            requirePaymentCaptured=False,
            allowPartialRefunds=False,
            manualReviewThreshold="200",
            restockingFeePercent=2.5,
        )
        response = client.put(f"{API}/policy", headers=headers, json=body)
        assert response.status_code == 200
        assert response.json() == {**body, "manualReviewThreshold": "200.00"}
        assert client.get(f"{API}/policy", headers=headers).json() == response.json()

    def test_a_change_writes_exactly_one_audit_entry(
        self, client: TestClient, headers: dict[str, str]
    ) -> None:
        put_policy(client, headers, returnWindowDays=14, restockingFeePercent=2.5)
        entries = audit(client, headers, eventType="policy_updated")
        assert len(entries) == 1
        entry = entries[0]
        assert entry["description"] == (
            "Return policy updated (return window 30 to 14 days, restocking fee 0% to 2.5%)."
        )
        assert (entry["actorName"], entry["actorType"], entry["returnId"]) == ("Asha", "seller", None)

    def test_saving_identical_values_is_a_no_op(self, client: TestClient, headers: dict[str, str]) -> None:
        assert put_policy(client, headers).status_code == 200
        assert put_policy(client, headers).status_code == 200
        assert audit(client, headers, eventType="policy_updated") == []

    def test_the_currency_cannot_be_changed(self, client: TestClient, headers: dict[str, str]) -> None:
        response = put_policy(client, headers, currency="EUR")
        assert response.status_code == 422
        assert response.json() == {"detail": "The currency cannot be changed.", "code": "invalid_input"}
        assert client.get(f"{API}/policy", headers=headers).json() == DEFAULT_POLICY

    INVALID = {
        "window of zero": {"returnWindowDays": 0},
        "window over 365": {"returnWindowDays": 366},
        "fractional window": {"returnWindowDays": 30.5},
        "window as text": {"returnWindowDays": "30"},
        "fee below zero": {"restockingFeePercent": -1},
        "fee above 100": {"restockingFeePercent": 100.01},
        "fee with three decimals": {"restockingFeePercent": 2.555},
        "fee as text": {"restockingFeePercent": "abc"},
        "fee as boolean": {"restockingFeePercent": True},
        "fee NaN": {"restockingFeePercent": "NaN"},
        "threshold as a number": {"manualReviewThreshold": 150.0},
        "negative threshold": {"manualReviewThreshold": "-5.00"},
        "threshold as text": {"manualReviewThreshold": "abc"},
        "flag as text": {"requirePaymentCaptured": "true"},
        "flag as number": {"allowPartialRefunds": 1},
        "unsupported currency": {"currency": "JPY"},
        "missing window": {"returnWindowDays": MISSING},
        "unknown field": {"role": "admin"},
    }

    @pytest.mark.parametrize("name", list(INVALID))
    def test_invalid_policies_are_refused_and_change_nothing(
        self, client: TestClient, headers: dict[str, str], name: str
    ) -> None:
        response = put_policy(client, headers, **self.INVALID[name])
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"
        assert client.get(f"{API}/policy", headers=headers).json() == DEFAULT_POLICY

    @pytest.mark.parametrize(
        ("override", "field", "expected"),
        [
            ({"returnWindowDays": 1}, "returnWindowDays", 1),
            ({"returnWindowDays": 365}, "returnWindowDays", 365),
            ({"restockingFeePercent": 100}, "restockingFeePercent", 100),
            ({"restockingFeePercent": 33.33}, "restockingFeePercent", 33.33),
            ({"restockingFeePercent": "2.50"}, "restockingFeePercent", 2.5),
            ({"manualReviewThreshold": "0"}, "manualReviewThreshold", "0.00"),
        ],
    )
    def test_boundary_values_are_accepted(
        self, client: TestClient, headers: dict[str, str], override: dict[str, Any], field: str, expected: Any
    ) -> None:
        response = put_policy(client, headers, **override)
        assert response.status_code == 200, response.text
        assert response.json()[field] == expected

    def test_a_policy_change_applies_to_new_returns_only(
        self, client: TestClient, headers: dict[str, str], order: Order
    ) -> None:
        first = file_return(client, headers, order)
        assert evaluation(client, headers, first)["eligible"] is True

        put_policy(client, headers, returnWindowDays=7)

        old = evaluation(client, headers, first)
        assert old["eligible"] is True  # the stored result is not re-run
        assert old["checks"][0]["detail"] == "Delivered 9 days ago; policy allows 30 days."

        second = file_return(client, headers, order, sku="CABLE", amount="12.50")
        new = evaluation(client, headers, second)
        assert new["eligible"] is False
        assert failed_codes(new) == ["RETURN_WINDOW_EXPIRED"]

    def test_turning_partial_refunds_off_takes_effect(
        self, client: TestClient, headers: dict[str, str], order: Order
    ) -> None:
        put_policy(client, headers, allowPartialRefunds=False)
        result = evaluation(client, headers, file_return(client, headers, order, sku="CABLE", amount="5.00"))
        assert result["eligible"] is False
        assert failed_codes(result) == ["PARTIAL_REFUND_NOT_ALLOWED"]

    def test_the_restocking_fee_lowers_the_most_that_can_be_refunded(
        self, client: TestClient, headers: dict[str, str], order: Order
    ) -> None:
        put_policy(client, headers, restockingFeePercent=10)

        cable = evaluation(client, headers, file_return(client, headers, order, sku="CABLE", amount="11.25"))
        assert cable["eligible"] is True  # 12.50 minus a 1.25 fee

        earbuds = evaluation(client, headers, file_return(client, headers, order, sku="EARBUDS", amount="72.00"))
        assert failed_codes(earbuds) == ["AMOUNT_EXCEEDS_REFUNDABLE"]  # 79.99 minus 8.00 is 71.99


# ---------- audit log ----------


class TestAudit:
    def test_entries_are_newest_first_with_resolved_names(
        self, client: TestClient, headers: dict[str, str], order: Order
    ) -> None:
        return_id = file_return(client, headers, order)
        decide(client, headers, return_id, "approve")

        entries = audit(client, headers)
        assert [e["eventType"] for e in entries] == [
            "return_approved",
            "review_started",
            "policy_evaluated",
            "return_submitted",
        ]
        times = [datetime.fromisoformat(e["occurredAt"].replace("Z", "+00:00")) for e in entries]
        assert times == sorted(times, reverse=True)

        by_type = {e["eventType"]: e for e in entries}
        assert (by_type["return_submitted"]["actorName"], by_type["return_submitted"]["actorType"]) == ("Asha", "seller")
        assert (by_type["policy_evaluated"]["actorName"], by_type["policy_evaluated"]["actorType"]) == ("ReturnWise", "system")
        assert (by_type["review_started"]["fromStatus"], by_type["review_started"]["toStatus"]) == ("submitted", "under_review")
        assert (by_type["return_approved"]["fromStatus"], by_type["return_approved"]["toStatus"]) == ("under_review", "approved")
        assert by_type["return_submitted"]["fromStatus"] is None
        assert by_type["policy_evaluated"]["toStatus"] is None

        for entry in entries:
            assert sorted(entry) == [
                "actorName", "actorType", "description", "eventType", "fromStatus",
                "id", "occurredAt", "returnId", "toStatus",
            ]
            assert entry["returnId"] == return_id

    def test_entries_hold_no_customer_text_or_contact_details(
        self, client: TestClient, headers: dict[str, str], order: Order
    ) -> None:
        file_return(client, headers, order, comment="SECRET-CUSTOMER-TEXT 555-0100")
        response = client.get(f"{API}/audit", headers=headers)
        for leaked in ("SECRET-CUSTOMER-TEXT", "555-0100", "aarav@example.com"):
            assert leaked not in response.text

    def test_filters(self, client: TestClient, headers: dict[str, str], order: Order) -> None:
        a = file_return(client, headers, order, sku="EARBUDS")
        b = file_return(client, headers, order, sku="CABLE", amount="12.50")
        decide(client, headers, a, "approve")

        full = audit(client, headers)
        assert len(full) == 6  # 4 for a, 2 for b

        approved = audit(client, headers, eventType="return_approved")
        assert [e["returnId"] for e in approved] == [a]
        assert len(audit(client, headers, returnId=a)) == 4
        assert len(audit(client, headers, returnId=b)) == 2
        assert len(audit(client, headers, actorType="system")) == 2
        assert audit(client, headers, actorType="ai") == []
        assert len(audit(client, headers, returnId=a, eventType="return_approved")) == 1
        assert audit(client, headers, limit=1) == full[:1]

    def test_policy_changes_have_no_return(
        self, client: TestClient, headers: dict[str, str], order: Order
    ) -> None:
        return_id = file_return(client, headers, order)
        put_policy(client, headers, returnWindowDays=14)

        assert len(audit(client, headers)) == 3
        assert len(audit(client, headers, returnId=return_id)) == 2
        assert [e["returnId"] for e in audit(client, headers, eventType="policy_updated")] == [None]

    @pytest.mark.parametrize(
        "params",
        [
            {"limit": 0},
            {"limit": 501},
            {"limit": "abc"},
            {"eventType": "bogus"},
            {"actorType": "bogus"},
            {"returnId": "not-an-id"},
            {"returnId": "RET_UPPER"},
        ],
    )
    def test_bad_filters_are_refused(
        self, client: TestClient, headers: dict[str, str], params: dict[str, Any]
    ) -> None:
        response = client.get(f"{API}/audit", headers=headers, params=params)
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"

    @pytest.mark.parametrize("method", ["DELETE", "PUT", "POST", "PATCH"])
    def test_the_log_cannot_be_changed_through_the_api(
        self, client: TestClient, headers: dict[str, str], method: str
    ) -> None:
        assert client.request(method, f"{API}/audit", headers=headers).status_code == 405

    def test_returns_cannot_be_deleted_either(
        self, client: TestClient, headers: dict[str, str], order: Order
    ) -> None:
        return_id = file_return(client, headers, order)
        assert client.delete(f"{API}/returns/{return_id}", headers=headers).status_code == 405
        assert client.get(f"{API}/returns/{return_id}", headers=headers).status_code == 200


# ---------- dashboard ----------


class TestDashboard:
    def test_an_empty_account(self, client: TestClient, headers: dict[str, str]) -> None:
        assert metrics(client, headers) == {
            "openReturns": 0,
            "awaitingReview": 0,
            "refundsPending": 0,
            "refundedThisMonth": "0.00",
            "currency": "USD",
            "avgDecisionHours": 0,
            "returnsByStatus": {status: 0 for status in STATUSES},
        }

    def test_counts_follow_the_workflow(
        self, client: TestClient, headers: dict[str, str], order: Order
    ) -> None:
        a = file_return(client, headers, order, sku="EARBUDS")
        b = file_return(client, headers, order, sku="CABLE", amount="12.50")

        m = metrics(client, headers)
        assert (m["openReturns"], m["awaitingReview"], m["returnsByStatus"]["submitted"]) == (2, 2, 2)

        client.post(f"{API}/returns/{a}/start-review", headers=headers)
        m = metrics(client, headers)
        assert (m["awaitingReview"], m["returnsByStatus"]["under_review"]) == (2, 1)

        client.post(f"{API}/returns/{a}/approve", headers=headers, json={"note": ""})
        m = metrics(client, headers)
        assert (m["awaitingReview"], m["returnsByStatus"]["approved"], m["openReturns"]) == (1, 1, 2)

        decide(client, headers, b, "reject")
        m = metrics(client, headers)
        assert (m["awaitingReview"], m["openReturns"], m["returnsByStatus"]["rejected"]) == (0, 1, 1)

        # Approval alone never counts as money refunded.
        assert (m["refundsPending"], m["refundedThisMonth"]) == (0, "0.00")
        assert m["avgDecisionHours"] >= 0

    def test_only_refunds_completed_this_month_count_as_refunded(
        self,
        client: TestClient,
        db: Session,
        seller: User,
        headers: dict[str, str],
        make_order: Callable[..., Order],
    ) -> None:
        orders = [
            make_order(seller, number=f"RW-30{n}", items=((f"SKU{n}", f"Item {n}", 1, 1000, True),))
            for n in range(3)
        ]
        ids = [file_return(client, headers, o, sku=f"SKU{n}", amount="10.00") for n, o in enumerate(orders)]

        now = datetime.now(timezone.utc)
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        def refund(n: int, status: RefundStatus, **extra: Any) -> Refund:
            return Refund(
                seller_id=seller.id,
                return_id=ids[n],
                order_id=orders[n].id,
                amount_minor=1000,
                currency=Currency.USD,
                status=status,
                idempotency_key=f"test-key-00000000{n}",
                **extra,
            )

        db.add_all(
            [
                refund(0, RefundStatus.COMPLETED, paypal_refund_id="TEST-ONLY-1", completed_at=now),
                refund(1, RefundStatus.COMPLETED, paypal_refund_id="TEST-ONLY-2", completed_at=month_start - timedelta(days=1)),
                refund(2, RefundStatus.PENDING),
            ]
        )
        db.commit()

        assert metrics(client, headers)["refundedThisMonth"] == "10.00"

        # Test shortcut only: the refund service does not exist yet, so set the status directly.
        pending = db.get(ReturnRequest, ids[2])
        assert pending is not None
        pending.status = ReturnStatus.REFUND_PENDING
        db.commit()

        m = metrics(client, headers)
        assert (m["refundsPending"], m["returnsByStatus"]["refund_pending"]) == (1, 1)
        assert (m["openReturns"], m["returnsByStatus"]["submitted"]) == (3, 2)

    def test_average_decision_time_uses_decided_returns_only(
        self,
        client: TestClient,
        db: Session,
        seller: User,
        headers: dict[str, str],
        order: Order,
        make_order: Callable[..., Order],
    ) -> None:
        extra = make_order(seller, number="RW-3001", items=(("MUG", "Mug", 1, 2500, True),))
        a = file_return(client, headers, order, sku="EARBUDS")
        b = file_return(client, headers, order, sku="CABLE", amount="12.50")
        file_return(client, headers, extra, sku="MUG", amount="25.00")  # never decided

        t0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)
        for return_id, hours in ((a, 2), (b, 4)):
            request = db.get(ReturnRequest, return_id)
            assert request is not None
            request.submitted_at = t0
            request.decided_at = t0 + timedelta(hours=hours)
        db.commit()

        assert metrics(client, headers)["avgDecisionHours"] == 3.0