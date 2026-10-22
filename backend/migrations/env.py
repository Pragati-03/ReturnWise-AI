from __future__ import annotations

from logging.config import fileConfig

from alembic import context

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.core.config import get_settings
from app.db.base import Base, UTCDateTime
from app.db.session import create_db_engine

config = context.config

if config.config_file_name is not None:
    # Keep the app's own loggers alive when Alembic configures logging.
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata
DATABASE_URL = get_settings().database_url


def render_item(type_: str, obj: object, autogen_context: object) -> str | bool:
    """Write app-specific column types as plain SQLAlchemy in generated migrations.

    Without this, migrations would import app.db.base, and an old migration could break
    the day that code changes.
    """
    if type_ == "type" and isinstance(obj, UTCDateTime):
        return "sa.DateTime(timezone=True)"
    return False  # use Alembic's default rendering for everything else


COMMON_OPTIONS = {
    "target_metadata": target_metadata,
    "compare_type": True,
    # Batch mode lets Alembic "alter" SQLite tables by rebuilding them. On PostgreSQL it
    # simply emits normal ALTER statements, so it is safe to leave on.
    "render_as_batch": True,
    "render_item": render_item,
}


def run_migrations_offline() -> None:
    """Emit SQL to the console instead of touching a database (alembic upgrade --sql)."""
    context.configure(
        url=DATABASE_URL,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **COMMON_OPTIONS,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # The same engine setup as the app (foreign keys on, WAL, busy timeout).
    # Known limit: a FUTURE batch migration that rebuilds a table other tables point to may
    # need "PRAGMA foreign_keys=OFF" first. The initial schema only creates tables.
    engine = create_db_engine(DATABASE_URL)
    try:
        with engine.connect() as connection:
            context.configure(connection=connection, **COMMON_OPTIONS)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()