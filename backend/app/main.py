from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import inspect
from starlette.datastructures import Headers, MutableHeaders
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import __version__
from app.api.deps import register_exception_handlers
from app.api.routes import auth, orders, returns, workspace
from app.core.config import get_settings
from app.db.session import check_database, engine

logger = logging.getLogger(__name__)

API_PREFIX = "/api/v1"
MAX_BODY_BYTES = 128 * 1024  # every request body in this API is a few hundred bytes


class BodySizeLimitMiddleware:
    """Refuse oversized bodies before they are read.

    Chunked uploads (no Content-Length) are refused too, because their size can't be
    checked up front. Browsers always send Content-Length for JSON requests.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        if "transfer-encoding" in headers:
            await self._reject(
                scope, receive, send, 411, "length_required", "Requests must declare a Content-Length."
            )
            return

        length = headers.get("content-length")
        if length is not None:
            if not (length.isascii() and length.isdigit()):
                await self._reject(scope, receive, send, 400, "bad_request", "Invalid Content-Length.")
                return
            if int(length) > self.max_bytes:
                await self._reject(
                    scope, receive, send, 413, "payload_too_large", "The request body is too large."
                )
                return

        await self.app(scope, receive, send)

    @staticmethod
    async def _reject(
        scope: Scope, receive: Receive, send: Send, status: int, code: str, detail: str
    ) -> None:
        response = JSONResponse(status_code=status, content={"detail": detail, "code": code})
        await response(scope, receive, send)


class SecurityHeadersMiddleware:
    """Adds protective headers to every response, including errors."""

    def __init__(self, app: ASGIApp, hsts: bool = False) -> None:
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        is_api = scope["path"].startswith(API_PREFIX)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("X-Frame-Options", "DENY")
                headers.setdefault("Referrer-Policy", "no-referrer")
                if is_api:
                    # API responses hold account data: never cache them. The CSP applies to
                    # JSON only, so it can't break the docs page, which lives outside /api.
                    headers.setdefault("Cache-Control", "no-store")
                    headers.setdefault(
                        "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
                    )
                if self.hsts:
                    headers.setdefault(
                        "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
                    )
            await send(message)

        await self.app(scope, receive, send_with_headers)


def _warn_if_schema_missing() -> None:
    try:
        if not inspect(engine).has_table("users"):
            logger.warning("Database tables not found. Run: alembic upgrade head")
    except Exception:
        logger.exception("Could not inspect the database at startup")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _warn_if_schema_missing()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )

    application = FastAPI(
        title="ReturnWise API",
        version=__version__,
        description="AI-assisted returns and refunds management for e-commerce sellers.",
        lifespan=lifespan,
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    register_exception_handlers(application)

    # add_middleware puts the LAST one added on the outside. Security headers go outermost,
    # so even CORS and size-limit rejections carry them. CORS sits outside the size limit,
    # so a 413 still reaches the browser as a readable error and not a CORS failure.
    application.add_middleware(BodySizeLimitMiddleware)
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,  # tokens travel in the Authorization header, not cookies
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "Idempotency-Key"],
        max_age=600,
    )
    application.add_middleware(SecurityHeadersMiddleware, hsts=settings.is_production)

    @application.get(f"{API_PREFIX}/health", tags=["health"])
    def health() -> JSONResponse:
        database_ok = check_database()
        return JSONResponse(
            status_code=200 if database_ok else 503,
            content={
                "status": "ok" if database_ok else "degraded",
                "database": "ok" if database_ok else "unavailable",
                "version": __version__,
            },
        )

    for module in (auth, orders, returns, workspace):
        application.include_router(module.router, prefix=API_PREFIX)

    return application


app = create_app()