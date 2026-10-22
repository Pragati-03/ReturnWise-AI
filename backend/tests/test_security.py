from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pytest
from pydantic import ValidationError

import app.core.security as security
from app.core.config import BACKEND_DIR, PLACEHOLDER_SECRET, Settings, get_settings
from app.core.security import (
    InvalidTokenError,
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

GENERIC = "Invalid or expired token"


def secret() -> str:
    return get_settings().jwt_secret.get_secret_value()


def now() -> datetime:
    return datetime.now(timezone.utc)


def claims_for(sub: str = "usr_abc", **over: Any) -> dict[str, Any]:
    claims: dict[str, Any] = {
        "sub": sub,
        "iss": "returnwise",
        "typ": "access",
        "iat": now(),
        "exp": now() + timedelta(hours=1),
    }
    claims.update(over)
    return claims


# ---------- passwords ----------


class TestPasswords:
    def test_hashes_are_bcrypt_salted_and_verifiable(self) -> None:
        first = hash_password("correct horse battery")
        second = hash_password("correct horse battery")
        assert first.startswith("$2") and len(first) == 60
        assert first != second  # a fresh salt every time
        assert verify_password("correct horse battery", first) is True
        assert verify_password("correct horse battery", second) is True

    def test_the_cost_factor_follows_the_setting(self) -> None:
        hashed = hash_password("correct horse battery")
        assert hashed[4:6] == f"{security.BCRYPT_ROUNDS:02d}"

    def test_the_plain_password_is_not_in_the_hash(self) -> None:
        assert "correct horse battery" not in hash_password("correct horse battery")

    @pytest.mark.parametrize(
        "attempt", ["wrong", "Correct horse battery", "correct horse battery ", " correct horse battery", ""]
    )
    def test_wrong_passwords_fail(self, attempt: str) -> None:
        hashed = hash_password("correct horse battery")
        assert verify_password(attempt, hashed) is False

    def test_unicode_passwords_work(self) -> None:
        password = "pässwörd-ünïcode-123"
        assert verify_password(password, hash_password(password)) is True

    def test_72_bytes_is_accepted_and_73_is_refused(self) -> None:
        assert hash_password("a" * 72).startswith("$2")
        with pytest.raises(ValueError, match="at most 72 bytes"):
            hash_password("a" * 73)
        with pytest.raises(ValueError, match="at most 72 bytes"):
            hash_password("é" * 37)  # 74 bytes: the limit is bytes, not characters

    def test_an_unknown_account_never_verifies_not_even_the_dummy_password(self) -> None:
        # The dummy hash exists only to equalize timing, so its own password must not log in.
        assert verify_password("not-a-real-password", None) is False
        assert verify_password("anything else", None) is False

    @pytest.mark.parametrize("broken", ["not-a-hash", "", "$2b$04$tooshort", "é-not-ascii"])
    def test_a_malformed_stored_hash_fails_closed_and_is_logged(
        self, broken: str, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.ERROR, logger="app.core.security"):
            assert verify_password("anything", broken) is False
        assert "Stored password hash is malformed" in caplog.text


# ---------- tokens ----------


class TestAccessTokens:
    def test_a_token_round_trips_to_its_subject(self) -> None:
        issued = create_access_token("usr_abc")
        assert issued.expires_in == get_settings().jwt_expire_minutes * 60
        assert isinstance(issued.token, str)
        assert decode_access_token(issued.token) == "usr_abc"

    def test_claims_and_header(self) -> None:
        token = create_access_token("usr_abc").token
        claims = jwt.decode(token, options={"verify_signature": False})
        assert sorted(claims) == ["exp", "iat", "iss", "sub", "typ"]
        assert (claims["sub"], claims["iss"], claims["typ"]) == ("usr_abc", "returnwise", "access")
        assert claims["exp"] - claims["iat"] == get_settings().jwt_expire_minutes * 60
        assert jwt.get_unverified_header(token)["alg"] == "HS256"

    def test_a_custom_lifetime_is_honoured(self) -> None:
        issued = create_access_token("usr_abc", timedelta(minutes=5))
        claims = jwt.decode(issued.token, options={"verify_signature": False})
        assert issued.expires_in == 300
        assert claims["exp"] - claims["iat"] == 300
        assert decode_access_token(issued.token) == "usr_abc"

    def test_a_little_clock_skew_is_tolerated_but_not_a_lot(self) -> None:
        assert decode_access_token(create_access_token("usr_abc", timedelta(seconds=-5)).token) == "usr_abc"
        with pytest.raises(InvalidTokenError):
            decode_access_token(create_access_token("usr_abc", timedelta(seconds=-30)).token)

    def test_a_tampered_signature_is_refused(self) -> None:
        # Alter the FIRST signature character: the last one carries unused bits and can
        # change without changing the decoded signature.
        header, payload, signature = create_access_token("usr_abc").token.split(".")
        flipped = ("A" if signature[0] != "A" else "B") + signature[1:]
        with pytest.raises(InvalidTokenError):
            decode_access_token(f"{header}.{payload}.{flipped}")

    FORGERIES = {
        "another secret": lambda: jwt.encode(claims_for(), "another-secret-" + "y" * 40, algorithm="HS256"),
        "alg none": lambda: jwt.encode(claims_for(), key=None, algorithm="none"),
        "other algorithm": lambda: jwt.encode(claims_for(), secret(), algorithm="HS384"),
        "expired": lambda: jwt.encode(claims_for(exp=now() - timedelta(minutes=5)), secret(), algorithm="HS256"),
        "wrong issuer": lambda: jwt.encode(claims_for(iss="someone-else"), secret(), algorithm="HS256"),
        "wrong type": lambda: jwt.encode(claims_for(typ="refresh"), secret(), algorithm="HS256"),
        "garbage": lambda: "not.a.token",
        "empty": lambda: "",
    }

    @pytest.mark.parametrize("name", list(FORGERIES))
    def test_bad_tokens_fail_with_one_generic_message(self, name: str) -> None:
        with pytest.raises(InvalidTokenError) as caught:
            decode_access_token(self.FORGERIES[name]())
        assert str(caught.value) == GENERIC  # never says why

    def test_the_error_is_not_a_jwt_library_exception(self) -> None:
        assert not issubclass(InvalidTokenError, jwt.PyJWTError)

    def test_rotating_the_secret_invalidates_existing_tokens(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        token = create_access_token("usr_abc").token
        monkeypatch.setenv("JWT_SECRET", "rotated-secret-" + "z" * 40)
        get_settings.cache_clear()
        try:
            with pytest.raises(InvalidTokenError):
                decode_access_token(token)
            assert decode_access_token(create_access_token("usr_abc").token) == "usr_abc"
        finally:
            monkeypatch.undo()
            get_settings.cache_clear()


# ---------- settings validation ----------


def settings(**over: Any) -> Settings:
    """Build settings from explicit values only (no .env file)."""
    return Settings(_env_file=None, **over)


class TestSettings:
    def test_the_test_environment_is_isolated(self) -> None:
        current = get_settings()
        assert current.app_env == "test"
        assert current.database_url == "sqlite://"
        assert not current.gemini_enabled
        assert not current.paypal_configured

    # --- production secret ---

    def test_production_refuses_the_placeholder_secret(self) -> None:
        with pytest.raises(ValidationError, match="at least 32 characters"):
            settings(app_env="production", jwt_secret=PLACEHOLDER_SECRET)

    def test_production_refuses_a_short_secret(self) -> None:
        with pytest.raises(ValidationError, match="at least 32 characters"):
            settings(app_env="production", jwt_secret="a" * 31)

    def test_production_accepts_a_long_secret(self) -> None:
        built = settings(app_env="production", jwt_secret="a" * 32)
        assert built.is_production is True

    @pytest.mark.parametrize("env", ["development", "test"])
    def test_other_environments_allow_the_placeholder(self, env: str) -> None:
        built = settings(app_env=env, jwt_secret=PLACEHOLDER_SECRET)
        assert built.is_production is False

    def test_unknown_environments_are_refused(self) -> None:
        with pytest.raises(ValidationError):
            settings(app_env="staging")

    # --- secrets stay secret ---

    def test_secrets_are_masked_in_every_representation(self) -> None:
        built = settings(
            jwt_secret="topsecret-" + "a" * 30,
            gemini_api_key="gemini-key-value",
            paypal_client_secret="paypal-secret-value",
        )
        for text in (repr(built), str(built), built.model_dump_json()):
            for leaked in ("topsecret-", "gemini-key-value", "paypal-secret-value"):
                assert leaked not in text

    # --- CORS ---

    def test_cors_origins_are_normalized(self) -> None:
        built = settings(cors_origins="http://a.test/ , https://b.test")
        assert built.cors_origin_list == ["http://a.test", "https://b.test"]

    @pytest.mark.parametrize(
        ("value", "message"),
        [
            ("*", "wildcard"),
            ("http://a.test,*", "wildcard"),
            ("localhost:5173", "must start with http"),
            ("ftp://a.test", "must start with http"),
            ("", "at least one origin"),
            (" , ", "at least one origin"),
        ],
    )
    def test_bad_cors_origins_are_refused(self, value: str, message: str) -> None:
        with pytest.raises(ValidationError, match=message):
            settings(cors_origins=value)

    # --- PayPal: sandbox only ---

    @pytest.mark.parametrize(
        "base",
        [
            "https://api-m.paypal.com",  # the LIVE host
            "https://api.paypal.com",
            "http://api-m.sandbox.paypal.com",  # not https
            "https://api-m.sandbox.paypal.com.evil.test",
            "https://evil.test/api-m.sandbox.paypal.com",
            "https://api-m.sandbox.paypal.com@evil.test",
            "https://sandbox.paypal.com",
            "",
        ],
    )
    def test_anything_but_the_sandbox_is_refused(self, base: str) -> None:
        with pytest.raises(ValidationError, match="SANDBOX"):
            settings(paypal_api_base=base)

    @pytest.mark.parametrize(
        ("base", "expected"),
        [
            ("https://api-m.sandbox.paypal.com", "https://api-m.sandbox.paypal.com"),
            ("https://api-m.sandbox.paypal.com/", "https://api-m.sandbox.paypal.com"),
            ("https://api.sandbox.paypal.com", "https://api.sandbox.paypal.com"),
        ],
    )
    def test_sandbox_hosts_are_accepted_and_normalized(self, base: str, expected: str) -> None:
        assert settings(paypal_api_base=base).paypal_api_base == expected

    def test_feature_flags_follow_the_credentials(self) -> None:
        assert settings().gemini_enabled is False
        assert settings(gemini_api_key="k").gemini_enabled is True
        assert settings(paypal_client_id="id").paypal_configured is False
        assert settings(paypal_client_secret="s").paypal_configured is False
        assert settings(paypal_client_id="id", paypal_client_secret="s").paypal_configured is True
        assert settings().paypal_webhook_configured is False
        assert settings(paypal_webhook_id="wh").paypal_webhook_configured is True

    # --- database URL ---

    def test_relative_sqlite_paths_are_anchored_to_backend(self) -> None:
        expected = (BACKEND_DIR / "x.db").resolve().as_posix()
        assert settings(database_url="sqlite:///./x.db").database_url == f"sqlite:///{expected}"

    @pytest.mark.parametrize("url", ["sqlite://", "sqlite:///:memory:", "postgresql+psycopg://u:p@localhost/db"])
    def test_other_database_urls_are_left_alone(self, url: str) -> None:
        assert settings(database_url=url).database_url == url

    def test_absolute_sqlite_paths_are_left_alone(self) -> None:
        url = "sqlite:///" + (BACKEND_DIR / "abs.db").resolve().as_posix()
        assert settings(database_url=url).database_url == url

    # --- ranges ---

    def test_log_level_is_case_insensitive(self) -> None:
        assert settings(log_level="debug").log_level == "DEBUG"
        with pytest.raises(ValidationError):
            settings(log_level="loud")

    @pytest.mark.parametrize(("minutes", "ok"), [(0, False), (1, True), (1440, True), (1441, False)])
    def test_token_lifetime_is_bounded(self, minutes: int, ok: bool) -> None:
        if ok:
            assert settings(jwt_expire_minutes=minutes).jwt_expire_minutes == minutes
        else:
            with pytest.raises(ValidationError):
                settings(jwt_expire_minutes=minutes)

    @pytest.mark.parametrize(("seconds", "ok"), [(0, False), (0.5, True), (60, True), (61, False)])
    def test_ai_timeout_is_bounded(self, seconds: float, ok: bool) -> None:
        if ok:
            assert settings(gemini_timeout_seconds=seconds).gemini_timeout_seconds == seconds
        else:
            with pytest.raises(ValidationError):
                settings(gemini_timeout_seconds=seconds)