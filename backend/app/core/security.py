from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from typing import NamedTuple

import bcrypt
import jwt

from app.core.config import get_settings

logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "returnwise"
TOKEN_TYPE = "access"
CLOCK_SKEW_SECONDS = 10

# bcrypt only looks at the first 72 bytes. Refusing longer passwords is safer than
# silently ignoring the tail. Tests may lower BCRYPT_ROUNDS to run faster.
MAX_PASSWORD_BYTES = 72
BCRYPT_ROUNDS = 12


class InvalidTokenError(Exception):
    """Raised for every token problem. The message is deliberately generic."""


class AccessToken(NamedTuple):
    token: str
    expires_in: int  # seconds


# ---------- Passwords ----------


def hash_password(plain: str) -> str:
    raw = plain.encode("utf-8")
    if len(raw) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")
    return bcrypt.hashpw(raw, bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode("ascii")


@lru_cache(maxsize=1)
def _dummy_hash() -> str:
    # Used when an email isn't registered, so a login attempt costs about the same
    # time whether or not the account exists (prevents timing-based user enumeration).
    return hash_password("not-a-real-password")


def verify_password(plain: str, hashed: str | None) -> bool:
    """True only if `plain` matches `hashed`. Pass None for an unknown account."""
    raw = plain.encode("utf-8")
    target = hashed if hashed is not None else _dummy_hash()
    try:
        matches = bcrypt.checkpw(raw[:MAX_PASSWORD_BYTES], target.encode("ascii"))
    except (ValueError, UnicodeEncodeError):
        # Malformed stored hash. Treat as a failed login and make noise in the logs.
        logger.error("Stored password hash is malformed")
        return False
    return matches and hashed is not None


# ---------- Access tokens ----------


def create_access_token(user_id: str, expires_delta: timedelta | None = None) -> AccessToken:
    settings = get_settings()
    lifetime = expires_delta if expires_delta is not None else timedelta(
        minutes=settings.jwt_expire_minutes
    )
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user_id,
        "iss": JWT_ISSUER,
        "typ": TOKEN_TYPE,
        "iat": now,
        "exp": now + lifetime,
    }
    token = jwt.encode(claims, settings.jwt_secret.get_secret_value(), algorithm=JWT_ALGORITHM)
    return AccessToken(token=token, expires_in=int(lifetime.total_seconds()))


def decode_access_token(token: str) -> str:
    """Return the user ID from a valid token, or raise InvalidTokenError."""
    settings = get_settings()
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[JWT_ALGORITHM],  # a fixed allow-list blocks the "alg: none" trick
            issuer=JWT_ISSUER,
            leeway=CLOCK_SKEW_SECONDS,
            options={"require": ["exp", "iat", "sub", "iss"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError("Invalid or expired token") from exc

    subject = claims.get("sub")
    if claims.get("typ") != TOKEN_TYPE or not isinstance(subject, str) or not subject:
        raise InvalidTokenError("Invalid or expired token")
    return subject