from __future__ import annotations

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.db.base import Base, TimestampMixin, new_id


class User(TimestampMixin, Base):
    """A seller account.

    Every business row (customer, order, return, policy, audit entry) carries a
    seller_id. All queries must filter by it, so one seller can never read or
    change another seller's data.
    """

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("usr"))
    email: Mapped[str] = mapped_column(String(254), unique=True, nullable=False)
    # bcrypt hash only. The plain password is never stored or logged.
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    @validates("email")
    def _normalize_email(self, _key: str, value: str) -> str:
        # Lowercase so "A@x.com" and "a@x.com" can't both register.
        return value.strip().lower()

    def __repr__(self) -> str:
        # Deliberately excludes email and name, so logs stay free of personal data.
        return f"<User {self.id}>"