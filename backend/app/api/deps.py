from __future__ import annotations

import logging
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import InvalidTokenError, decode_access_token
from app.db.session import get_db
from app.models.user import User
from app.services import auth as auth_service
from app.services.errors import AuthenticationError, DomainError

logger = logging.getLogger(__name__)

NOT_AUTHENTICATED_MESSAGE = "Not authenticated."
SERVER_ERROR_MESSAGE = "Something went wrong on our side. Please try again."

# auto_error=False so we answer with our own error shape instead of FastAPI's default.
bearer_scheme = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: DbSession,
) -> User:
    """The signed-in seller. The account is re-checked on every request, so a disabled
    account stops working immediately, even with an unexpired token."""
    if credentials is None:
        raise AuthenticationError(NOT_AUTHENTICATED_MESSAGE)
    try:
        user_id = decode_access_token(credentials.credentials)
    except InvalidTokenError as exc:
        raise AuthenticationError(auth_service.INVALID_SESSION_MESSAGE) from exc
    return auth_service.get_active_user(db, user_id)


CurrentUser = Annotated[User, Depends(get_current_user)]


# ---------- Error handling ----------


def _friendly(message: str) -> str:
    # Pydantic prefixes errors raised by our own validators with "Value error, ".
    prefix = "Value error, "
    return message[len(prefix):] if message.startswith(prefix) else message


async def _domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
    headers = {"WWW-Authenticate": "Bearer"} if exc.status_code == 401 else None
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict(), headers=headers)


async def _validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    # Only the field location and message go back. The default response also includes the
    # submitted value ("input"), which would echo passwords and customer text.
    problems = [
        {"loc": list(error.get("loc", ())), "msg": _friendly(str(error.get("msg", "Invalid value")))}
        for error in exc.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": problems, "code": "validation_error"})


async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    # Full details go to the server log (path only: no query string, which could hold tokens).
    logger.error(
        "Unhandled error on %s %s", request.method, request.url.path, exc_info=exc
    )
    return JSONResponse(
        status_code=500, content={"detail": SERVER_ERROR_MESSAGE, "code": "server_error"}
    )


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainError, _domain_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, _validation_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, _unhandled_error_handler)