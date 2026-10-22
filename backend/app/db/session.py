from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.engine import Connection, make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings

logger = logging.getLogger(__name__)


def _configure_sqlite(engine: Engine, in_memory: bool) -> None:
    """SQLite needs explicit setup to behave like a real database."""

    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_connection, _record) -> None:  # type: ignore[no-untyped-def]
        # Take over transaction control from the sqlite3 module, whose default
        # behavior is unreliable (it delays BEGIN and mishandles savepoints).
        dbapi_connection.isolation_level = None

        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")  # off by default in SQLite
            cursor.execute("PRAGMA busy_timeout=5000")  # wait up to 5s on a locked database
            if not in_memory:
                cursor.execute("PRAGMA journal_mode=WAL")  # readers don't block the writer
                cursor.execute("PRAGMA synchronous=NORMAL")
        finally:
            cursor.close()

    @event.listens_for(engine, "begin")
    def _on_begin(connection: Connection) -> None:
        connection.exec_driver_sql("BEGIN")


def create_db_engine(database_url: str) -> Engine:
    """Build an engine for SQLite today and PostgreSQL later (just change DATABASE_URL)."""
    url = make_url(database_url)

    if url.get_backend_name() == "sqlite":
        in_memory = url.database in (None, "", ":memory:")
        kwargs: dict = {"connect_args": {"check_same_thread": False}}
        if in_memory:
            # One shared connection, so every thread (including tests) sees the same database.
            kwargs["poolclass"] = StaticPool
        engine = create_engine(url, **kwargs)
        _configure_sqlite(engine, in_memory)
        return engine

    return create_engine(url, pool_pre_ping=True)


engine: Engine = create_db_engine(get_settings().database_url)

# expire_on_commit=False keeps objects readable after commit, so responses can
# be built from them without extra queries.
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request.

    It never commits automatically. Services commit explicitly, and closing the
    session rolls back anything left uncommitted if a request fails.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """For scripts (seeding, maintenance): commit on success, roll back on error."""
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def check_database() -> bool:
    """Used by the health endpoint. Never raises."""
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        logger.exception("Database health check failed")
        return False