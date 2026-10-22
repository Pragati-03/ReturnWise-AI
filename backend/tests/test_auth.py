from __future__ import annotations

import base64
import json
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, decode_access_token
from app.models import ReturnPolicy, User

API = "/api/v1"
PASSWORD = "correct horse battery"

INVALID_TOKEN = {"detail": "Invalid or expired token.", "code": "unauthorized"}
NOT_AUTHENTICATED = {"detail": "Not authenticated.", "code": "unauthorized"}
BAD_LOGIN = {"detail": "Incorrect email or password.", "code": "unauthorized"}
DROP = object()  # marks a JWT claim to leave out


# ---------- helpers ----------


def secret() -> str:
    return get_settings().jwt_secret.get_secret_value()


def now() -> datetime:
    return datetime.now(timezone.utc)


def valid_registration(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"email": "asha@example.com", "password": PASSWORD, "displayName": "Asha"}
    body.update(over)
    return body


def register(client: TestClient, **over: Any):
    return client.post(f"{API}/auth/register", json=valid_registration(**over))


def login(client: TestClient, email: str = "asha@example.com", password: str = PASSWORD):
    return client.post(f"{API}/auth/login", json={"email": email, "password": password})


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def me(client: TestClient, token: str):
    return client.get(f"{API}/auth/me", headers=bearer(token))


def signup(client: TestClient) -> tuple[str, str]:
    """Register and log in. Returns (user_id, access_token)."""
    user_id = register(client).json()["id"]
    token = login(client).json()["accessToken"]
    return user_id, token


def claims_for(user_id: str, **over: Any) -> dict[str, Any]:
    claims: dict[str, Any] = {
        "sub": user_id,
        "iss": "returnwise",
        "typ": "access",
        "iat": now(),
        "exp": now() + timedelta(hours=1),
    }
    for key, value in over.items():
        if value is DROP:
            claims.pop(key, None)
        else:
            claims[key] = value
    return claims


def sign(claims: dict[str, Any], key: str | None = None, algorithm: str = "HS256") -> str:
    if algorithm == "none":
        return jwt.encode(claims, key=None, algorithm="none")
    return jwt.encode(claims, key or secret(), algorithm=algorithm)


# ---------- registration ----------


class TestRegister:
    def test_creates_an_account(self, client: TestClient) -> None:
        response = register(client, email="Asha@Example.com")
        assert response.status_code == 201
        body = response.json()
        assert sorted(body) == ["displayName", "email", "id"]
        assert body["email"] == "asha@example.com"
        assert body["displayName"] == "Asha"
        assert body["id"].startswith("usr_")
        assert "password" not in response.text.lower()
        assert "$2" not in response.text  # no bcrypt hash either

    def test_the_display_name_is_trimmed(self, client: TestClient) -> None:
        assert register(client, displayName="  Asha  ").json()["displayName"] == "Asha"

    def test_only_a_password_hash_is_stored(self, client: TestClient, db: Session) -> None:
        register(client)
        user = db.scalar(select(User).where(User.email == "asha@example.com"))
        assert user is not None
        assert user.password_hash.startswith("$2")
        assert PASSWORD not in user.password_hash

    def test_a_default_policy_is_created(self, client: TestClient, db: Session) -> None:
        user_id = register(client).json()["id"]
        policy = db.scalar(select(ReturnPolicy).where(ReturnPolicy.seller_id == user_id))
        assert policy is not None
        assert policy.return_window_days == 30

    def test_emails_are_unique_ignoring_case(self, client: TestClient, db: Session) -> None:
        assert register(client, email="asha@example.com").status_code == 201
        second = register(client, email="ASHA@example.com", displayName="Someone else")
        assert second.status_code == 409
        assert second.json() == {
            "detail": "An account with this email already exists.",
            "code": "conflict",
        }
        assert db.scalar(select(func.count()).select_from(User)) == 1

    @pytest.mark.parametrize("password", ["twelvechars!", "a" * 72, "é" * 36])
    def test_accepted_password_lengths_work_end_to_end(
        self, client: TestClient, password: str
    ) -> None:
        assert register(client, password=password).status_code == 201
        assert login(client, password=password).status_code == 200

    REJECTED = {
        "password too short": {"password": "elevenchars"},
        "password over 72 bytes": {"password": "a" * 73},
        "password over 72 bytes (multibyte)": {"password": "é" * 37},
        "invalid email": {"email": "not-an-email"},
        "empty name": {"displayName": ""},
        "blank name": {"displayName": "   "},
        "control character in name": {"displayName": "A\x00sha"},
        "name too long": {"displayName": "n" * 101},
        "unknown field": {"role": "admin"},
    }

    @pytest.mark.parametrize("name", list(REJECTED))
    def test_bad_registrations_are_refused(
        self, client: TestClient, db: Session, name: str
    ) -> None:
        response = register(client, **self.REJECTED[name])
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"
        assert db.scalar(select(func.count()).select_from(User)) == 0

    @pytest.mark.parametrize("field", ["email", "password", "displayName"])
    def test_every_field_is_required(self, client: TestClient, field: str) -> None:
        body = valid_registration()
        del body[field]
        response = client.post(f"{API}/auth/register", json=body)
        assert response.status_code == 422
        assert any(error["loc"][-1] == field for error in response.json()["detail"])

    @pytest.mark.parametrize("extra", [{"email": "not-an-email"}, {"displayName": ""}])
    def test_validation_errors_never_echo_the_password(
        self, client: TestClient, extra: dict[str, str]
    ) -> None:
        typed = "pw-SECRET-Value-123"
        response = register(client, password=typed, **extra)
        assert response.status_code == 422
        assert typed not in response.text

    def test_malformed_json_is_a_clean_422(self, client: TestClient) -> None:
        response = client.post(
            f"{API}/auth/register", content="{not json", headers={"Content-Type": "application/json"}
        )
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"

    def test_passwords_are_never_trimmed(self, client: TestClient) -> None:
        padded = "  twelve chars+  "
        assert register(client, password=padded).status_code == 201
        assert login(client, password=padded).status_code == 200
        assert login(client, password=padded.strip()).status_code == 401


# ---------- login ----------


class TestLogin:
    def test_returns_a_bearer_token(self, client: TestClient) -> None:
        register(client)
        response = login(client)
        body = response.json()
        assert response.status_code == 200
        assert sorted(body) == ["accessToken", "expiresIn", "tokenType"]
        assert body["tokenType"] == "bearer"
        assert body["expiresIn"] == get_settings().jwt_expire_minutes * 60
        assert response.headers["cache-control"] == "no-store"
        assert decode_access_token(body["accessToken"]).startswith("usr_")

    def test_the_token_does_not_contain_personal_data(self, client: TestClient) -> None:
        register(client)
        token = login(client).json()["accessToken"]
        claims = jwt.decode(token, options={"verify_signature": False})
        assert sorted(claims) == ["exp", "iat", "iss", "sub", "typ"]

    def test_email_matching_ignores_case(self, client: TestClient) -> None:
        register(client)
        assert login(client, email="ASHA@Example.COM").status_code == 200

    def test_wrong_password_and_unknown_email_look_identical(self, client: TestClient) -> None:
        register(client)
        wrong = login(client, password="wrong password here")
        unknown = login(client, email="nobody@example.com")
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json() == BAD_LOGIN
        assert wrong.headers["www-authenticate"] == "Bearer"

    def test_a_disabled_account_cannot_log_in_and_looks_the_same(
        self, client: TestClient, db: Session, make_seller: Callable[..., User]
    ) -> None:
        user = make_seller()
        user.is_active = False
        db.commit()
        response = login(client)
        assert response.status_code == 401
        assert response.json() == BAD_LOGIN

    INVALID_LOGINS = {
        "empty password": {"email": "asha@example.com", "password": ""},
        "password too long": {"email": "asha@example.com", "password": "x" * 129},
        "missing email": {"password": PASSWORD},
        "missing password": {"email": "asha@example.com"},
        "malformed email": {"email": "nope", "password": PASSWORD},
        "unknown field": {"email": "asha@example.com", "password": PASSWORD, "remember": True},
    }

    @pytest.mark.parametrize("name", list(INVALID_LOGINS))
    def test_malformed_login_requests_are_refused(self, client: TestClient, name: str) -> None:
        response = client.post(f"{API}/auth/login", json=self.INVALID_LOGINS[name])
        assert response.status_code == 422
        assert response.json()["code"] == "validation_error"


# ---------- tokens ----------

FORGERIES: dict[str, Callable[[str], str]] = {
    "expired": lambda uid: sign(claims_for(uid, exp=now() - timedelta(seconds=60))),
    "signed with another secret": lambda uid: sign(
        claims_for(uid), key="a-different-secret-" + "y" * 40
    ),
    "unsigned (alg none)": lambda uid: sign(claims_for(uid), algorithm="none"),
    "different algorithm (HS384)": lambda uid: sign(claims_for(uid), algorithm="HS384"),
    "missing exp": lambda uid: sign(claims_for(uid, exp=DROP)),
    "missing iat": lambda uid: sign(claims_for(uid, iat=DROP)),
    "missing iss": lambda uid: sign(claims_for(uid, iss=DROP)),
    "missing sub": lambda uid: sign(claims_for(uid, sub=DROP)),
    "wrong issuer": lambda uid: sign(claims_for(uid, iss="someone-else")),
    "wrong token type": lambda uid: sign(claims_for(uid, typ="refresh")),
    "numeric subject": lambda uid: sign(claims_for(uid, sub=123)),
    "empty subject": lambda uid: sign(claims_for(uid, sub="")),
    "not valid yet": lambda uid: sign(claims_for(uid, nbf=now() + timedelta(hours=1))),
}


class TestTokens:
    def test_a_valid_token_returns_the_account(self, client: TestClient) -> None:
        user_id, token = signup(client)
        response = me(client, token)
        assert response.status_code == 200
        assert response.json() == {"id": user_id, "email": "asha@example.com", "displayName": "Asha"}

    def test_the_scheme_name_is_case_insensitive(self, client: TestClient) -> None:
        _, token = signup(client)
        response = client.get(f"{API}/auth/me", headers={"Authorization": f"bearer {token}"})
        assert response.status_code == 200

    def test_missing_credentials(self, client: TestClient) -> None:
        response = client.get(f"{API}/auth/me")
        assert response.status_code == 401
        assert response.json() == NOT_AUTHENTICATED
        assert response.headers["www-authenticate"] == "Bearer"

    def test_a_different_auth_scheme_is_not_accepted(self, client: TestClient) -> None:
        response = client.get(f"{API}/auth/me", headers={"Authorization": "Basic YTpi"})
        assert response.status_code == 401
        assert response.json() == NOT_AUTHENTICATED

    @pytest.mark.parametrize("garbage", ["not.a.token", "a.b.c", "x" * 20])
    def test_garbage_tokens_are_refused(self, client: TestClient, garbage: str) -> None:
        response = me(client, garbage)
        assert response.status_code == 401
        assert response.json() == INVALID_TOKEN

    @pytest.mark.parametrize("name", list(FORGERIES))
    def test_forged_or_defective_tokens_are_refused(self, client: TestClient, name: str) -> None:
        user_id = register(client).json()["id"]  # a real account, so only the token can be at fault
        response = me(client, FORGERIES[name](user_id))
        assert response.status_code == 401, name
        assert response.json() == INVALID_TOKEN

    def test_editing_a_token_payload_breaks_the_signature(self, client: TestClient) -> None:
        register(client)
        other_id = register(client, email="ben@example.com", displayName="Ben").json()["id"]
        token = login(client).json()["accessToken"]

        header, payload, signature = token.split(".")
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        claims["sub"] = other_id  # try to become the other seller
        forged_payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()

        response = me(client, f"{header}.{forged_payload}.{signature}")
        assert response.status_code == 401
        assert response.json() == INVALID_TOKEN

    def test_a_token_for_an_account_that_does_not_exist_is_refused(self, client: TestClient) -> None:
        response = me(client, create_access_token("usr_ghost").token)
        assert response.status_code == 401
        assert response.json() == INVALID_TOKEN

    def test_disabling_an_account_revokes_its_tokens_immediately(
        self,
        client: TestClient,
        db: Session,
        make_seller: Callable[..., User],
        login_headers: Callable[..., dict[str, str]],
    ) -> None:
        user = make_seller()
        headers = login_headers()
        assert client.get(f"{API}/auth/me", headers=headers).status_code == 200

        user.is_active = False
        db.commit()
        response = client.get(f"{API}/auth/me", headers=headers)
        assert response.status_code == 401
        assert response.json() == INVALID_TOKEN

        user.is_active = True  # re-checked on every request, so re-enabling works too
        db.commit()
        assert client.get(f"{API}/auth/me", headers=headers).status_code == 200


# ---------- route protection ----------

RETURN_BODY = {
    "orderId": "ord_x",
    "items": [{"orderItemId": "itm_x", "quantity": 1}],
    "customerComment": "c",
    "requestedAmount": "1.00",
}
POLICY_BODY = {
    "returnWindowDays": 30,
    "requirePaymentCaptured": True,
    "allowPartialRefunds": True,
    "manualReviewThreshold": "150.00",
    "currency": "USD",
    "restockingFeePercent": 0,
}
PROTECTED: list[tuple[str, str, dict[str, Any] | None]] = [
    ("GET", "/auth/me", None),
    ("GET", "/orders", None),
    ("GET", "/orders/ord_x", None),
    ("GET", "/returns", None),
    ("POST", "/returns", RETURN_BODY),
    ("GET", "/returns/ret_x", None),
    ("GET", "/returns/ret_x/evaluation", None),
    ("POST", "/returns/ret_x/start-review", None),
    ("POST", "/returns/ret_x/approve", {"note": ""}),
    ("POST", "/returns/ret_x/reject", {"note": "No"}),
    ("GET", "/policy", None),
    ("PUT", "/policy", POLICY_BODY),
    ("GET", "/audit", None),
    ("GET", "/dashboard/metrics", None),
]
PROTECTED_IDS = [f"{method} {path}" for method, path, _ in PROTECTED]


class TestRouteProtection:
    @pytest.mark.parametrize(("method", "path", "body"), PROTECTED, ids=PROTECTED_IDS)
    def test_no_token_means_401(
        self, client: TestClient, method: str, path: str, body: dict[str, Any] | None
    ) -> None:
        response = client.request(method, f"{API}{path}", json=body)
        assert response.status_code == 401
        assert response.json() == NOT_AUTHENTICATED
        assert response.headers["www-authenticate"] == "Bearer"

    @pytest.mark.parametrize(("method", "path", "body"), PROTECTED, ids=PROTECTED_IDS)
    def test_a_bad_token_means_401(
        self, client: TestClient, method: str, path: str, body: dict[str, Any] | None
    ) -> None:
        response = client.request(method, f"{API}{path}", json=body, headers=bearer("not.a.token"))
        assert response.status_code == 401
        assert response.json() == INVALID_TOKEN

    def test_health_register_and_login_need_no_token(self, client: TestClient) -> None:
        health = client.get(f"{API}/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"
        assert register(client).status_code == 201
        assert login(client).status_code == 200