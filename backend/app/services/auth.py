from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import AccessToken, create_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest
from app.services.errors import AuthenticationError, ConflictError
from app.services.returns import get_or_create_policy

INVALID_LOGIN_MESSAGE = "Incorrect email or password."
EMAIL_TAKEN_MESSAGE = "An account with this email already exists."
INVALID_SESSION_MESSAGE = "Invalid or expired token."


def _find_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.strip().lower()))


def register(db: Session, payload: RegisterRequest) -> User:
    """Create a seller account and its default return policy in one transaction."""
    email = payload.email.strip().lower()
    if _find_by_email(db, email) is not None:
        raise ConflictError(EMAIL_TAKEN_MESSAGE)

    user = User(
        email=email,
        password_hash=hash_password(payload.password.get_secret_value()),
        display_name=payload.display_name,
    )
    db.add(user)
    try:
        db.flush()  # the unique email constraint fires here if two sign-ups race
    except IntegrityError as exc:
        db.rollback()
        raise ConflictError(EMAIL_TAKEN_MESSAGE) from exc

    try:
        get_or_create_policy(db, user.id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return user


def authenticate(db: Session, email: str, password: str) -> User:
    user = _find_by_email(db, email)
    # Always runs a full bcrypt check, even for unknown emails (dummy hash), so response
    # time doesn't reveal whether the account exists.
    password_ok = verify_password(password, user.password_hash if user else None)
    if user is None or not password_ok or not user.is_active:
        raise AuthenticationError(INVALID_LOGIN_MESSAGE)
    return user


def login(db: Session, payload: LoginRequest) -> tuple[User, AccessToken]:
    user = authenticate(db, payload.email, payload.password.get_secret_value())
    return user, create_access_token(user.id)


def get_active_user(db: Session, user_id: str) -> User:
    """For the current-user dependency: re-checks the account on every request."""
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthenticationError(INVALID_SESSION_MESSAGE)
    return user