from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from app.models import Order, User

API = "/api/v1"


def return_body(order_id: str, item_id: str, amount: str, quantity: int = 1) -> dict[str, Any]:
    return {
        "orderId": order_id,
        "items": [{"orderItemId": item_id, "quantity": quantity}],
        "customerComment": "It stopped working.",
        "requestedAmount": amount,
    }


def policy_body(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "returnWindowDays": 30,
        "requirePaymentCaptured": True,
        "allowPartialRefunds": True,
        "manualReviewThreshold": "150.00",
        "currency": "USD",
        "restockingFeePercent": 0,
    }
    body.update(over)
    return body


@dataclass
class World:
    owner_id: str
    outsider_id: str
    owner_h: dict[str, str]
    outsider_h: dict[str, str]
    order_id: str
    other_order_id: str
    items: dict[str, str]  # owner's order: sku -> item id
    other_items: dict[str, str]  # outsider's order: sku -> item id
    return_id: str  # the owner's return


@pytest.fixture
def world(
    client: TestClient,
    make_seller: Callable[..., User],
    make_order: Callable[..., Order],
    login_headers: Callable[..., dict[str, str]],
) -> World:
    owner = make_seller("asha@example.com", "Asha")
    outsider = make_seller("ben@example.com", "Ben")
    order = make_order(owner)  # RW-2001: earbuds and cables, captured, delivered 9 days ago
    other = make_order(
        outsider,
        number="RW-9001",
        customer_email="bela@example.com",
        items=(("MUG", "Mug", 1, 2500, True),),
    )
    owner_h = login_headers("asha@example.com")
    outsider_h = login_headers("ben@example.com")
    items = {item.sku: item.id for item in order.items}

    created = client.post(
        f"{API}/returns", headers=owner_h, json=return_body(order.id, items["EARBUDS"], "79.99")
    )
    assert created.status_code == 201, created.text

    return World(
        owner_id=owner.id,
        outsider_id=outsider.id,
        owner_h=owner_h,
        outsider_h=outsider_h,
        order_id=order.id,
        other_order_id=other.id,
        items=items,
        other_items={item.sku: item.id for item in other.items},
        return_id=created.json()["id"],
    )


def audit_for(client: TestClient, headers: dict[str, str], **params: str) -> list[dict[str, Any]]:
    response = client.get(f"{API}/audit", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def status_of(client: TestClient, headers: dict[str, str], return_id: str) -> str:
    response = client.get(f"{API}/returns/{return_id}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["status"]


# ---------- reading ----------


class TestReading:
    def test_each_seller_sees_only_their_own_orders(self, client: TestClient, world: World) -> None:
        mine = client.get(f"{API}/orders", headers=world.owner_h)
        theirs = client.get(f"{API}/orders", headers=world.outsider_h)
        assert [o["orderNumber"] for o in mine.json()] == ["RW-2001"]
        assert [o["orderNumber"] for o in theirs.json()] == ["RW-9001"]
        assert "bela@example.com" not in mine.text
        assert "aarav@example.com" not in theirs.text

    def test_each_seller_sees_only_their_own_returns(
        self, client: TestClient, make_order: Callable[..., Order], world: World
    ) -> None:
        mine = client.get(f"{API}/returns", headers=world.owner_h).json()
        theirs = client.get(f"{API}/returns", headers=world.outsider_h).json()
        assert [r["id"] for r in mine] == [world.return_id]
        assert theirs == []
        assert client.get(f"{API}/returns?status=submitted", headers=world.outsider_h).json() == []

    ROUTES = [
        ("GET", "/orders/{order}", None),
        ("GET", "/returns/{ret}", None),
        ("GET", "/returns/{ret}/evaluation", None),
        ("POST", "/returns/{ret}/start-review", None),
        ("POST", "/returns/{ret}/approve", {"note": "x"}),
        ("POST", "/returns/{ret}/reject", {"note": "x"}),
    ]

    @pytest.mark.parametrize(
        ("method", "template", "body"), ROUTES, ids=[f"{m} {t}" for m, t, _ in ROUTES]
    )
    def test_someone_elses_resource_looks_exactly_like_a_missing_one(
        self, client: TestClient, world: World, method: str, template: str, body: Any
    ) -> None:
        foreign = client.request(
            method,
            API + template.format(order=world.order_id, ret=world.return_id),
            headers=world.outsider_h,
            json=body,
        )
        missing = client.request(
            method,
            API + template.format(order="ord_doesnotexist", ret="ret_doesnotexist"),
            headers=world.outsider_h,
            json=body,
        )
        assert foreign.status_code == missing.status_code == 404
        assert foreign.json() == missing.json()

    def test_the_audit_log_is_private(
        self, client: TestClient, world: World
    ) -> None:
        theirs = client.post(
            f"{API}/returns",
            headers=world.outsider_h,
            json=return_body(world.other_order_id, world.other_items["MUG"], "25.00"),
        )
        assert theirs.status_code == 201
        their_return = theirs.json()["id"]

        mine_log = audit_for(client, world.owner_h)
        their_log = audit_for(client, world.outsider_h)
        assert {e["returnId"] for e in mine_log} == {world.return_id}
        assert {e["returnId"] for e in their_log} == {their_return}
        assert len(mine_log) == len(their_log) == 2

        # Filtering by the other seller's return ID reveals nothing.
        assert audit_for(client, world.outsider_h, returnId=world.return_id) == []
        assert audit_for(client, world.owner_h, returnId=their_return) == []

    def test_dashboards_are_private(self, client: TestClient, world: World) -> None:
        mine = client.get(f"{API}/dashboard/metrics", headers=world.owner_h).json()
        theirs = client.get(f"{API}/dashboard/metrics", headers=world.outsider_h).json()
        assert (mine["openReturns"], mine["awaitingReview"]) == (1, 1)
        assert mine["returnsByStatus"]["submitted"] == 1
        assert (theirs["openReturns"], theirs["awaitingReview"]) == (0, 0)
        assert sum(theirs["returnsByStatus"].values()) == 0

    def test_a_token_only_ever_shows_its_own_profile(self, client: TestClient, world: World) -> None:
        assert client.get(f"{API}/auth/me", headers=world.owner_h).json()["email"] == "asha@example.com"
        assert client.get(f"{API}/auth/me", headers=world.outsider_h).json()["email"] == "ben@example.com"


# ---------- writing ----------


class TestWriting:
    def test_cannot_file_a_return_on_someone_elses_order(
        self, client: TestClient, world: World
    ) -> None:
        stolen = return_body(world.order_id, world.items["CABLE"], "12.50")
        attempt = client.post(f"{API}/returns", headers=world.outsider_h, json=stolen)
        missing = client.post(
            f"{API}/returns",
            headers=world.outsider_h,
            json={**stolen, "orderId": "ord_doesnotexist"},
        )
        assert attempt.status_code == missing.status_code == 404
        assert attempt.json() == missing.json()

        assert client.get(f"{API}/returns", headers=world.outsider_h).json() == []
        assert len(client.get(f"{API}/returns", headers=world.owner_h).json()) == 1

        # The failed attempt used nothing up: the real owner can still file the same return.
        assert client.post(f"{API}/returns", headers=world.owner_h, json=stolen).status_code == 201

    def test_failed_attempts_change_nothing(self, client: TestClient, world: World) -> None:
        before = audit_for(client, world.owner_h)
        for action, body in (
            ("start-review", None),
            ("approve", {"note": "nope"}),
            ("reject", {"note": "nope"}),
        ):
            response = client.post(
                f"{API}/returns/{world.return_id}/{action}", headers=world.outsider_h, json=body
            )
            assert response.status_code == 404, action

        assert status_of(client, world.owner_h, world.return_id) == "submitted"
        assert audit_for(client, world.owner_h) == before

        # Same once the owner has the return under review.
        client.post(f"{API}/returns/{world.return_id}/start-review", headers=world.owner_h)
        denied = client.post(
            f"{API}/returns/{world.return_id}/approve", headers=world.outsider_h, json={"note": "x"}
        )
        assert denied.status_code == 404
        assert status_of(client, world.owner_h, world.return_id) == "under_review"

    def test_policy_settings_are_per_seller(self, client: TestClient, world: World) -> None:
        owner_put = client.put(
            f"{API}/policy", headers=world.owner_h, json=policy_body(returnWindowDays=14)
        )
        assert owner_put.status_code == 200
        assert client.get(f"{API}/policy", headers=world.outsider_h).json()["returnWindowDays"] == 30

        outsider_put = client.put(
            f"{API}/policy", headers=world.outsider_h, json=policy_body(returnWindowDays=7)
        )
        assert outsider_put.status_code == 200
        assert client.get(f"{API}/policy", headers=world.owner_h).json()["returnWindowDays"] == 14

        for headers in (world.owner_h, world.outsider_h):
            assert len(audit_for(client, headers, eventType="policy_updated")) == 1


# ---------- client-supplied hints ----------


class TestOwnershipHintsAreIgnored:
    def test_headers_and_query_strings_cannot_name_another_seller(
        self, client: TestClient, world: World
    ) -> None:
        orders = client.get(
            f"{API}/orders",
            params={"sellerId": world.owner_id},
            headers={**world.outsider_h, "X-Seller-Id": world.owner_id},
        )
        assert [o["orderNumber"] for o in orders.json()] == ["RW-9001"]

        audit = client.get(
            f"{API}/audit", params={"sellerId": world.owner_id}, headers=world.outsider_h
        )
        assert audit.status_code == 200
        assert audit.json() == []

    def test_bodies_cannot_name_another_seller(self, client: TestClient, world: World) -> None:
        sneaky_return = {
            **return_body(world.other_order_id, world.other_items["MUG"], "25.00"),
            "sellerId": world.owner_id,
        }
        response = client.post(f"{API}/returns", headers=world.outsider_h, json=sneaky_return)
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"

        sneaky_policy = policy_body(sellerId=world.owner_id)
        response = client.put(f"{API}/policy", headers=world.outsider_h, json=sneaky_policy)
        assert response.status_code == 422

    def test_a_status_cannot_be_smuggled_into_a_new_return(
        self, client: TestClient, world: World
    ) -> None:
        sneaky = {
            **return_body(world.order_id, world.items["CABLE"], "12.50"),
            "status": "approved",
        }
        assert client.post(f"{API}/returns", headers=world.owner_h, json=sneaky).status_code == 422


# ---------- hostile identifiers ----------


class TestHostileIdentifiers:
    @pytest.mark.parametrize(
        "value",
        ["x' OR '1'='1", "1; DROP TABLE return_requests;--", "' UNION SELECT * FROM users --"],
    )
    def test_injection_shaped_ids_are_just_not_found(
        self, client: TestClient, world: World, value: str
    ) -> None:
        response = client.get(f"{API}/returns/{quote(value, safe='')}", headers=world.owner_h)
        assert response.status_code == 404
        assert response.json()["code"] == "not_found"

        # The data and the tables are intact.
        assert status_of(client, world.owner_h, world.return_id) == "submitted"
        assert len(client.get(f"{API}/returns", headers=world.owner_h).json()) == 1

    def test_overlong_ids_are_a_validation_error(self, client: TestClient, world: World) -> None:
        response = client.get(f"{API}/returns/{'a' * 65}", headers=world.owner_h)
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"

    def test_status_filter_only_accepts_real_statuses(self, client: TestClient, world: World) -> None:
        response = client.get(
            f"{API}/returns", params={"status": "submitted' OR 1=1"}, headers=world.owner_h
        )
        assert response.status_code == 422