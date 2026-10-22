from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AfterValidator, ConfigDict, EmailStr, SecretStr

from app.models.user import User
from app.schemas.common import PersonName, RequestModel, ResponseModel

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_BYTES = 72  # bcrypt ignores or rejects anything longer
MAX_LOGIN_PASSWORD_LENGTH = 128  # cap login input so huge payloads are cheap to refuse


def _normalize_email(value: str) -> str:
    return value.strip().lower()


NormalizedEmail = Annotated[EmailStr, AfterValidator(_normalize_email)]


def _check_new_password(value: SecretStr) -> SecretStr:
    raw = value.get_secret_value()
    if len(raw) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if len(raw.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password must be at most {MAX_PASSWORD_BYTES} bytes")
    return value


def _check_login_password(value: SecretStr) -> SecretStr:
    raw = value.get_secret_value()
    if not raw or len(raw) > MAX_LOGIN_PASSWORD_LENGTH:
        raise ValueError("Invalid password")
    return value


NewPassword = Annotated[SecretStr, AfterValidator(_check_new_password)]
LoginPassword = Annotated[SecretStr, AfterValidator(_check_login_password)]


class RegisterRequest(RequestModel):
    # Passwords must never be altered, so turn off the base class's whitespace stripping.
    # (display_name and email still strip themselves through their own types.)
    model_config = ConfigDict(str_strip_whitespace=False)

    email: NormalizedEmail
    password: NewPassword
    display_name: PersonName


class LoginRequest(RequestModel):
    model_config = ConfigDict(str_strip_whitespace=False)

    email: NormalizedEmail
    password: LoginPassword


class TokenResponse(ResponseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    # Lifetime in seconds.
    expires_in: int


class UserResponse(ResponseModel):
    id: str
    email: str
    display_name: str

    @classmethod
    def from_model(cls, user: User) -> UserResponse:
        return cls(id=user.id, email=user.email, display_name=user.display_name)