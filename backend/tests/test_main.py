from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Callable, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

import app.models  # noqa: F401  (registers every table)
from app import __version__
from app.core.config import get_settings
from app.db.base import Base
from app.db.session import check_database, create_db_engine
from app.db.session import engine as global_engine
from app.main import (
    MAX_BODY_BYTES,
    BodySizeLimitMiddleware,
    SecurityHeadersMiddleware,
    create_app,
)
from app.models import User
from app.services.errors import (
    AuthenticationError,
    ConflictError,
    DomainError,
    ExternalServiceError,
    ForbiddenError,
    InvalidInputError,
    InvalidTransitionError,
    NotFoundError,
    PolicyViolationError,
)

API = "/api/v1"
ORIGIN = "http://localhost:5173"
EVIL = "http://evil.example"
JSON_HEADERS = {"content-type": "application/json"}


# ---------- raw ASGI helpers (for testing middleware in isolation) ----------


def make_inner(response_headers: list[tuple[bytes, bytes]] | None = None):
    calls: list[str] = []

    async def inner(scope, receive, send) -> None:  # type: ignore[no-untyped-def]
        calls.append(scope["type"])
        if scope["type"] == "http":
            await send(
                {"type": "http.response.start", "status": 204, "headers": list(response_headers or [])}
            )
            await send({"type": "http.response.body", "body": b""})

    return inner, calls


def run_asgi(app, *, headers=(), scope_type: str = "http", path: str = "/") -> list[dict[str, Any]]:  # type: ignore[no-untyped-def]
    scope = {
        "type": scope_type,
        "method": "POST",
        "path": path,
        "query_string": b"",
        "headers": list(headers),
    }
    sent: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        sent.append(message)

    asyncio.run(app(scope, receive, send))
    return sent


def status_of(sent: list[dict[str, Any]]) -> int:
    return next(m for m in sent if m["type"] == "http.response.start")["status"]


def start_headers(sent: list[dict[str, Any]]) -> dict[str, str]:
    start = next(m for m in sent if m["type"] == "http.response.start")
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in start["headers"]}


def body_of(sent: list[dict[str, Any]]) -> dict[str, Any]:
    return json.loads(next(m for m in sent if m["type"] == "http.response.body")["body"])


# ---------- health ----------


class TestHealth:
    def test_reports_ok_and_needs_no_token(self, client: TestClient) -> None:
        response = client.get(f"{API}/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok", "database": "ok", "version": __version__}

    def test_reports_503_when_the_database_is_down(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr("app.main.check_database", lambda: False)
        response = client.get(f"{API}/health")
        assert response.status_code == 503
        assert response.json() == {
            "status": "degraded",
            "database": "unavailable",
            "version": __version__,
        }

    def test_the_response_is_never_cached(self, client: TestClient) -> None:
        assert client.get(f"{API}/health").headers["cache-control"] == "no-store"

    def test_check_database_is_true_for_a_working_database(self) -> None:
        assert check_database() is True

    def test_check_database_never_raises_for_a_broken_one(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path, caplog: pytest.LogCaptureFixture
    ) -> None:
        broken = create_db_engine("sqlite:///" + (tmp_path / "missing" / "x.db").as_posix())
        monkeypatch.setattr("app.db.session.engine", broken)
        try:
            with caplog.at_level(logging.ERROR):
                assert check_database() is False
        finally:
            broken.dispose()
        assert "Database health check failed" in caplog.text


# ---------- security headers ----------

RESPONSES: list[tuple[str, str, dict[str, Any], int]] = [
    ("GET", "/health", {}, 200),
    ("GET", "/orders", {}, 401),
    ("GET", "/nope", {}, 404),
    ("DELETE", "/orders", {}, 405),
    ("POST", "/auth/login", {"content": "{bad", "headers": JSON_HEADERS}, 422),
]


class TestSecurityHeaders:
    @pytest.mark.parametrize(
        ("method", "path", "kwargs", "expected"),
        RESPONSES,
        ids=[f"{m} {p} -> {s}" for m, p, _k, s in RESPONSES],
    )
    def test_every_api_response_carries_them_including_errors(
        self, client: TestClient, method: str, path: str, kwargs: dict[str, Any], expected: int
    ) -> None:
        response = client.request(method, f"{API}{path}", **kwargs)
        assert response.status_code == expected
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["x-frame-options"] == "DENY"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["content-security-policy"] == (
            "default-src 'none'; frame-ancestors 'none'"
        )

    def test_hsts_is_off_outside_production(self, client: TestClient) -> None:
        assert "strict-transport-security" not in client.get(f"{API}/health").headers

    def test_the_docs_page_is_not_broken_by_the_api_csp(self, client: TestClient) -> None:
        response = client.get("/docs")
        assert response.status_code == 200
        assert "content-security-policy" not in response.headers
        assert response.headers["x-content-type-options"] == "nosniff"

    def test_redoc_is_never_served(self, client: TestClient) -> None:
        assert client.get("/redoc").status_code == 404


class TestSecurityHeadersMiddleware:
    def run(self, path: str, *, hsts: bool = False, inner_headers=None) -> dict[str, str]:  # type: ignore[no-untyped-def]
        inner, _calls = make_inner(inner_headers)
        return start_headers(run_asgi(SecurityHeadersMiddleware(inner, hsts=hsts), path=path))

    def test_api_paths_get_the_full_set(self) -> None:
        headers = self.run("/api/v1/orders")
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert headers["referrer-policy"] == "no-referrer"
        assert headers["cache-control"] == "no-store"
        assert headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'"
        assert "strict-transport-security" not in headers

    def test_other_paths_skip_the_cache_and_csp_headers(self) -> None:
        headers = self.run("/docs")
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert "cache-control" not in headers
        assert "content-security-policy" not in headers

    def test_hsts_appears_only_when_enabled(self) -> None:
        assert self.run("/api/v1/x", hsts=True)["strict-transport-security"] == (
            "max-age=31536000; includeSubDomains"
        )
        assert "strict-transport-security" not in self.run("/api/v1/x", hsts=False)

    def test_headers_set_by_the_app_are_not_overwritten(self) -> None:
        headers = self.run(
            "/api/v1/x",
            inner_headers=[(b"x-frame-options", b"SAMEORIGIN"), (b"cache-control", b"max-age=60")],
        )
        assert headers["x-frame-options"] == "SAMEORIGIN"
        assert headers["cache-control"] == "max-age=60"

    def test_non_http_traffic_passes_straight_through(self) -> None:
        inner, calls = make_inner()
        sent = run_asgi(SecurityHeadersMiddleware(inner), scope_type="lifespan")
        assert calls == ["lifespan"]
        assert sent == []


# ---------- CORS ----------

PREFLIGHT = {
    "origin": ORIGIN,
    "access-control-request-method": "POST",
    "access-control-request-headers": "authorization,content-type,idempotency-key",
}


class TestCors:
    def test_the_frontend_origin_is_allowed_with_the_right_methods_and_headers(
        self, client: TestClient
    ) -> None:
        response = client.options(f"{API}/returns", headers=PREFLIGHT)
        assert response.status_code == 200
        assert response.headers["access-control-allow-origin"] == ORIGIN
        assert response.headers["access-control-max-age"] == "600"
        methods = {m.strip() for m in response.headers["access-control-allow-methods"].split(",")}
        assert methods == {"GET", "POST", "PUT", "OPTIONS"}
        allowed = response.headers["access-control-allow-headers"].lower()
        for name in ("authorization", "content-type", "accept", "idempotency-key"):
            assert name in allowed
        assert "access-control-allow-credentials" not in response.headers
        assert response.headers["x-content-type-options"] == "nosniff"

    def test_put_is_allowed_for_the_policy_form(self, client: TestClient) -> None:
        headers = {**PREFLIGHT, "access-control-request-method": "PUT"}
        assert client.options(f"{API}/policy", headers=headers).status_code == 200

    @pytest.mark.parametrize("method", ["DELETE", "PATCH"])
    def test_other_methods_are_refused(self, client: TestClient, method: str) -> None:
        headers = {**PREFLIGHT, "access-control-request-method": method}
        response = client.options(f"{API}/returns", headers=headers)
        assert response.status_code == 400
        # The browser blocks the real request because the method is not on the allowed list.
        allowed = {
            m.strip() for m in response.headers.get("access-control-allow-methods", "").split(",")
        }
        assert method not in allowed
        assert {"GET", "POST", "PUT", "OPTIONS"} <= allowed

    def test_other_origins_are_refused(self, client: TestClient) -> None:
        response = client.options(f"{API}/returns", headers={**PREFLIGHT, "origin": EVIL})
        assert response.status_code == 400
        assert "access-control-allow-origin" not in response.headers

    def test_unlisted_request_headers_are_refused(self, client: TestClient) -> None:
        headers = {**PREFLIGHT, "access-control-request-headers": "x-evil"}
        assert client.options(f"{API}/returns", headers=headers).status_code == 400

    def test_real_requests_from_the_frontend_get_the_allow_header(self, client: TestClient) -> None:
        response = client.get(f"{API}/health", headers={"origin": ORIGIN})
        assert response.headers["access-control-allow-origin"] == ORIGIN
        assert "Origin" in response.headers.get("vary", "")
        assert "access-control-allow-credentials" not in response.headers

    def test_real_requests_from_other_origins_do_not(self, client: TestClient) -> None:
        response = client.get(f"{API}/health", headers={"origin": EVIL})
        assert response.status_code == 200  # the server answers; the browser is what blocks it
        assert "access-control-allow-origin" not in response.headers

    def test_requests_without_an_origin_get_no_cors_headers(self, client: TestClient) -> None:
        assert "access-control-allow-origin" not in client.get(f"{API}/health").headers

    def test_error_responses_carry_cors_headers_so_the_frontend_can_read_them(
        self, client: TestClient
    ) -> None:
        response = client.get(f"{API}/orders", headers={"origin": ORIGIN})
        assert response.status_code == 401
        assert response.headers["access-control-allow-origin"] == ORIGIN

# ---------- request size limits ----------


class TestBodyLimits:
    def test_a_body_exactly_at_the_limit_is_read(self, client: TestClient) -> None:
        response = client.post(
            f"{API}/auth/login", content=b"x" * MAX_BODY_BYTES, headers=JSON_HEADERS
        )
        assert response.status_code == 422  # not JSON, but it got past the size check
        assert response.json()["code"] == "validation_error"

    def test_one_byte_over_is_refused_before_reading(self, client: TestClient) -> None:
        response = client.post(
            f"{API}/auth/login", content=b"x" * (MAX_BODY_BYTES + 1), headers=JSON_HEADERS
        )
        assert response.status_code == 413
        assert response.json() == {
            "detail": "The request body is too large.",
            "code": "payload_too_large",
        }
        assert response.headers["x-content-type-options"] == "nosniff"

    def test_the_refusal_still_carries_cors_headers(self, client: TestClient) -> None:
        response = client.post(
            f"{API}/auth/login",
            content=b"x" * (MAX_BODY_BYTES + 1),
            headers={**JSON_HEADERS, "origin": ORIGIN},
        )
        assert response.status_code == 413
        assert response.headers["access-control-allow-origin"] == ORIGIN

    def test_chunked_uploads_are_refused(self, client: TestClient) -> None:
        response = client.post(f"{API}/auth/login", content=iter([b"{}"]), headers=JSON_HEADERS)
        assert response.status_code == 411
        assert response.json() == {
            "detail": "Requests must declare a Content-Length.",
            "code": "length_required",
        }

    def test_requests_without_a_body_are_unaffected(self, client: TestClient) -> None:
        assert client.get(f"{API}/health").status_code == 200


class TestBodySizeLimitMiddleware:
    def build(self, limit: int = 10):  # type: ignore[no-untyped-def]
        inner, calls = make_inner()
        return BodySizeLimitMiddleware(inner, max_bytes=limit), calls

    @pytest.mark.parametrize("length", [b"0", b"5", b"10"])
    def test_lengths_up_to_the_limit_pass_through(self, length: bytes) -> None:
        middleware, calls = self.build()
        sent = run_asgi(middleware, headers=[(b"content-length", length)])
        assert calls == ["http"]
        assert status_of(sent) == 204

    @pytest.mark.parametrize("length", [b"11", b"99999999999999999999999"])
    def test_lengths_over_the_limit_are_refused_without_calling_the_app(self, length: bytes) -> None:
        middleware, calls = self.build()
        sent = run_asgi(middleware, headers=[(b"content-length", length)])
        assert calls == []
        assert status_of(sent) == 413
        assert body_of(sent)["code"] == "payload_too_large"

    @pytest.mark.parametrize("length", [b"abc", b"-5", b"1e3", b"", b"1 0", b"\xb2"])
    def test_malformed_lengths_are_a_400_and_never_a_crash(self, length: bytes) -> None:
        middleware, calls = self.build()
        sent = run_asgi(middleware, headers=[(b"content-length", length)])
        assert calls == []
        assert status_of(sent) == 400
        assert body_of(sent) == {"detail": "Invalid Content-Length.", "code": "bad_request"}

    def test_chunked_encoding_is_refused_even_with_a_length(self) -> None:
        middleware, calls = self.build()
        headers = [(b"transfer-encoding", b"chunked"), (b"content-length", b"5")]
        sent = run_asgi(middleware, headers=headers)
        assert calls == []
        assert status_of(sent) == 411

    def test_a_request_with_no_length_header_passes_through(self) -> None:
        middleware, calls = self.build()
        assert status_of(run_asgi(middleware)) == 204
        assert calls == ["http"]

    @pytest.mark.parametrize("scope_type", ["lifespan", "websocket"])
    def test_non_http_traffic_passes_straight_through(self, scope_type: str) -> None:
        middleware, calls = self.build()
        run_asgi(middleware, scope_type=scope_type)
        assert calls == [scope_type]


# ---------- error handling ----------

DOMAIN_CASES: list[tuple[str, Callable[[], DomainError], int, str]] = [
    ("invalid input", lambda: InvalidInputError("Bad input."), 422, "invalid_input"),
    ("authentication", lambda: AuthenticationError("Nope."), 401, "unauthorized"),
    ("forbidden", lambda: ForbiddenError("No."), 403, "forbidden"),
    ("not found", lambda: NotFoundError("Missing."), 404, "not_found"),
    ("conflict", lambda: ConflictError("Clash."), 409, "conflict"),
    ("invalid transition", lambda: InvalidTransitionError("submitted", "approved"), 409, "invalid_transition"),
    ("policy violation", lambda: PolicyViolationError("Policy."), 422, "policy_violation"),
    ("external service", lambda: ExternalServiceError("Upstream."), 502, "external_service_error"),
    ("base class", lambda: DomainError("Plain."), 400, "error"),
    ("custom code", lambda: DomainError("Custom.", code="custom_code"), 400, "custom_code"),
]


class TestErrorHandling:
    @pytest.mark.parametrize(
        ("_name", "factory", "status", "code"),
        DOMAIN_CASES,
        ids=[case[0] for case in DOMAIN_CASES],
    )
    def test_domain_errors_map_to_clean_json(
        self, client: TestClient, _name: str, factory: Callable[[], DomainError], status: int, code: str
    ) -> None:
        def raise_it() -> None:
            raise factory()

        client.app.add_api_route("/raise", raise_it, methods=["GET"])  # type: ignore[attr-defined]

        response = client.get("/raise")
        assert response.status_code == status
        assert response.json() == {"detail": factory().message, "code": code}
        if status == 401:
            assert response.headers["www-authenticate"] == "Bearer"
        else:
            assert "www-authenticate" not in response.headers

    def test_unexpected_errors_are_generic_and_logged_without_the_query_string(
        self, client: TestClient, caplog: pytest.LogCaptureFixture
    ) -> None:
        def boom() -> None:
            raise RuntimeError("secret internals")

        client.app.add_api_route("/boom", boom, methods=["GET"])  # type: ignore[attr-defined]
        quiet = TestClient(client.app, raise_server_exceptions=False)

        with caplog.at_level(logging.ERROR):
            response = quiet.get("/boom?token=SECRET-TOKEN")

        assert response.status_code == 500
        assert response.json() == {
            "detail": "Something went wrong on our side. Please try again.",
            "code": "server_error",
        }
        assert "secret internals" not in response.text
        assert "Unhandled error on GET /boom" in caplog.text
        assert "RuntimeError: secret internals" in caplog.text  # full detail stays in the log
        assert "SECRET-TOKEN" not in caplog.text

    def test_validation_errors_use_one_clean_shape(
        self,
        client: TestClient,
        make_seller: Callable[..., User],
        login_headers: Callable[..., dict[str, str]],
    ) -> None:
        make_seller()
        body = {
            "orderId": "ord_abc123",
            "items": [
                {"orderItemId": "itm_abc123", "quantity": 1},
                {"orderItemId": "itm_abc123", "quantity": 2},
            ],
            "customerComment": "SECRET-COMMENT-TEXT",
            "requestedAmount": "5.00",
        }
        response = client.post(f"{API}/returns", headers=login_headers(), json=body)

        assert response.status_code == 422
        payload = response.json()
        assert payload["code"] == "validation_error"
        assert all(sorted(problem) == ["loc", "msg"] for problem in payload["detail"])
        assert {
            "loc": ["body", "items"],
            "msg": "Each order item may appear only once in a return request",
        } in payload["detail"]
        assert "SECRET-COMMENT-TEXT" not in response.text

    def test_a_missing_body_is_a_422_with_the_location(self, client: TestClient) -> None:
        response = client.post(f"{API}/auth/login")
        assert response.status_code == 422
        assert response.json()["detail"] == [{"loc": ["body"], "msg": "Field required"}]


# ---------- startup ----------


class TestStartup:
    def test_warns_when_the_tables_are_missing(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.WARNING, logger="app.main"):
            with TestClient(create_app()):
                pass
        assert "alembic upgrade head" in caplog.text

    def test_is_quiet_when_the_tables_exist(self, caplog: pytest.LogCaptureFixture) -> None:
        Base.metadata.create_all(global_engine)
        try:
            with caplog.at_level(logging.WARNING, logger="app.main"):
                with TestClient(create_app()):
                    pass
        finally:
            Base.metadata.drop_all(global_engine)  # leave the shared engine as we found it
        assert "alembic upgrade head" not in caplog.text


# ---------- production mode ----------


@pytest.fixture
def production_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()
    try:
        yield TestClient(create_app())
    finally:
        get_settings.cache_clear()


class TestProduction:
    @pytest.mark.parametrize("path", ["/docs", "/openapi.json", "/redoc"])
    def test_the_docs_are_switched_off(self, production_client: TestClient, path: str) -> None:
        assert production_client.get(path).status_code == 404

    def test_hsts_is_enabled(self, production_client: TestClient) -> None:
        response = production_client.get(f"{API}/health")
        assert response.status_code == 200
        assert response.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"
        assert response.headers["x-content-type-options"] == "nosniff"


# ---------- OpenAPI contract ----------

EXPECTED_PATHS = [
    "/api/v1/audit",
    "/api/v1/auth/login",
    "/api/v1/auth/me",
    "/api/v1/auth/register",
    "/api/v1/dashboard/metrics",
    "/api/v1/health",
    "/api/v1/orders",
    "/api/v1/orders/{order_id}",
    "/api/v1/policy",
    "/api/v1/returns",
    "/api/v1/returns/{return_id}",
    "/api/v1/returns/{return_id}/approve",
    "/api/v1/returns/{return_id}/evaluation",
    "/api/v1/returns/{return_id}/reject",
    "/api/v1/returns/{return_id}/start-review",
]
INTERNAL_FIELDS = {
    "sellerId", "seller_id", "passwordHash", "password_hash",
    "versionId", "version_id", "isActive", "is_active",
}


class TestOpenApiContract:
    @pytest.fixture
    def spec(self, client: TestClient) -> dict[str, Any]:
        response = client.get("/openapi.json")
        assert response.status_code == 200
        return response.json()

    def test_exactly_the_planned_endpoints_exist(self, spec: dict[str, Any]) -> None:
        assert sorted(spec["paths"]) == EXPECTED_PATHS

    def test_basic_metadata(self, spec: dict[str, Any]) -> None:
        assert spec["info"]["title"] == "ReturnWise API"
        assert spec["info"]["version"] == __version__

    def test_no_internal_column_appears_in_any_schema(self, spec: dict[str, Any]) -> None:
        exposed = {
            name
            for schema in spec["components"]["schemas"].values()
            for name in schema.get("properties", {})
        }
        assert exposed & INTERNAL_FIELDS == set()

    def test_the_wire_format_is_camel_case(self, spec: dict[str, Any]) -> None:
        token = spec["components"]["schemas"]["TokenResponse"]["properties"]
        assert {"accessToken", "tokenType", "expiresIn"} <= set(token)