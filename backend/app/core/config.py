from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)

# backend/app/core/config.py -> parents[2] is the backend/ folder.
BACKEND_DIR = Path(__file__).resolve().parents[2]

PLACEHOLDER_SECRET = "change-me"
MIN_PRODUCTION_SECRET_LENGTH = 32

# Sandbox only. The live PayPal host (api-m.paypal.com) is deliberately absent.
ALLOWED_PAYPAL_HOSTS = {"api-m.sandbox.paypal.com", "api.sandbox.paypal.com"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- App ---
    app_env: Literal["development", "test", "production"] = "development"
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"

    # --- Database ---
    database_url: str = "sqlite:///./returnwise.db"

    # --- Auth ---
    jwt_secret: SecretStr = SecretStr(PLACEHOLDER_SECRET)
    jwt_expire_minutes: int = Field(default=60, ge=1, le=1440)

    # --- CORS (comma-separated; use cors_origin_list to read it) ---
    cors_origins: str = "http://localhost:5173"

    # --- AI (optional) ---
    gemini_api_key: SecretStr = SecretStr("")
    gemini_timeout_seconds: float = Field(default=10, gt=0, le=60)

    # --- PayPal sandbox (optional) ---
    paypal_client_id: str = ""
    paypal_client_secret: SecretStr = SecretStr("")
    paypal_webhook_id: str = ""
    paypal_api_base: str = "https://api-m.sandbox.paypal.com"

    # ---------- Validators ----------

    @field_validator("log_level", mode="before")
    @classmethod
    def _upper_log_level(cls, value: object) -> object:
        return value.upper() if isinstance(value, str) else value

    @field_validator("database_url")
    @classmethod
    def _anchor_sqlite_path(cls, value: str) -> str:
        """Make relative SQLite paths relative to backend/, not to the shell's folder."""
        value = value.strip()
        prefix = "sqlite:///"
        if not value.startswith(prefix):
            return value

        path = value[len(prefix):]
        if not path or path == ":memory:" or path.startswith("file:"):
            return value
        if Path(path).is_absolute() or path.startswith("/"):
            return value

        absolute = (BACKEND_DIR / path).resolve()
        return f"{prefix}{absolute.as_posix()}"

    @field_validator("cors_origins")
    @classmethod
    def _validate_cors_origins(cls, value: str) -> str:
        origins = [item.strip().rstrip("/") for item in value.split(",") if item.strip()]
        if not origins:
            raise ValueError("CORS_ORIGINS must list at least one origin")
        for origin in origins:
            if origin == "*":
                raise ValueError("CORS_ORIGINS must not use a wildcard; list explicit origins")
            if not origin.startswith(("http://", "https://")):
                raise ValueError(f"CORS origin must start with http:// or https://: {origin}")
        return ",".join(origins)

    @field_validator("paypal_api_base")
    @classmethod
    def _sandbox_only(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        parsed = urlparse(value)
        if parsed.scheme != "https" or parsed.hostname not in ALLOWED_PAYPAL_HOSTS:
            raise ValueError(
                "PAYPAL_API_BASE must be a PayPal SANDBOX host "
                "(https://api-m.sandbox.paypal.com). Live PayPal is not allowed."
            )
        return value

    @model_validator(mode="after")
    def _require_real_secret_in_production(self) -> "Settings":
        if self.app_env == "production":
            secret = self.jwt_secret.get_secret_value()
            if secret == PLACEHOLDER_SECRET or len(secret) < MIN_PRODUCTION_SECRET_LENGTH:
                raise ValueError(
                    "JWT_SECRET must be a random value of at least "
                    f"{MIN_PRODUCTION_SECRET_LENGTH} characters in production"
                )
        return self

    # ---------- Derived values ----------

    @property
    def cors_origin_list(self) -> list[str]:
        return self.cors_origins.split(",")

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def gemini_enabled(self) -> bool:
        return bool(self.gemini_api_key.get_secret_value())

    @property
    def paypal_configured(self) -> bool:
        return bool(self.paypal_client_id and self.paypal_client_secret.get_secret_value())

    @property
    def paypal_webhook_configured(self) -> bool:
        return bool(self.paypal_webhook_id)


@lru_cache
def get_settings() -> Settings:
    """Cached settings. Tests that change env vars should call get_settings.cache_clear()."""
    settings = Settings()
    if settings.jwt_secret.get_secret_value() == PLACEHOLDER_SECRET:
        logger.warning(
            "JWT_SECRET is still the placeholder. Set a random value in backend/.env."
        )
    return settings