"""Refresh lifecycle on committed, isolated synthetic PostgreSQL schemas."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import UTC, date, datetime

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, insert, select, text, update
from sqlalchemy.orm import Session

from retail_data_platform.analytics import (
    ANALYTICAL_VIEWS,
    AnalyticsRefreshError,
    analytics_status,
    refresh_analytics,
)
from retail_data_platform.database.models import (
    AnalyticsRefreshRun,
    ImportRun,
    Store,
    TypologySnapshot,
)


@pytest.fixture
def database() -> Iterator[Engine]:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for PostgreSQL refresh tests")
    admin = create_engine(url)
    schema = "test_refresh_" + uuid.uuid4().hex
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        with engine.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def seed(database: Engine) -> uuid.UUID:
    store_id = uuid.uuid4()
    with Session(database) as session, session.begin():
        session.add(Store(id=store_id, source_key="synthetic", name="Before refresh"))
        session.flush()
        session.add(
            TypologySnapshot(
                id=uuid.uuid4(),
                source_key="a" * 64,
                period=date(2025, 1, 1),
                store_id=store_id,
                store_match_status="matched",
                store_match_method="synthetic",
            )
        )
    return store_id


def import_success(database: Engine) -> None:
    with database.begin() as c:
        c.execute(
            insert(ImportRun).values(
                id=uuid.uuid4(),
                dataset="synthetic",
                source_file_name="synthetic bundle",
                source_sha256=uuid.uuid4().hex * 2,
                status="succeeded",
                completed_at=datetime.now(UTC),
            )
        )


def stored_name(database: Engine) -> str:
    with database.connect() as c:
        value = c.scalar(text("SELECT current_store_name FROM analytics_store_month"))
        assert isinstance(value, str)
        return value


def test_initial_refresh_freshness_and_unique_grain(database: Engine) -> None:
    seed(database)
    assert analytics_status(database)["state"] == "uninitialized"
    import_success(database)
    stages: list[str] = []
    refresh_analytics(database, progress=stages.append)
    assert stages == list(ANALYTICAL_VIEWS)
    assert analytics_status(database)["state"] == "current"
    assert stored_name(database) == "Before refresh"
    import_success(database)
    assert analytics_status(database)["state"] == "stale"
    refresh_analytics(database)
    assert analytics_status(database)["state"] == "current"
    with database.connect() as c:
        for name in ANALYTICAL_VIEWS:
            assert (
                c.scalar(
                    text(
                        "SELECT count(*) FROM pg_index WHERE indrelid = to_regclass(:name) "
                        "AND indisunique AND indisvalid AND indpred IS NULL AND indexprs IS NULL"
                    ),
                    {"name": name},
                )
                == 1
            )
        assert c.scalar(text("SELECT count(*) FROM analytics_store_month")) == 1


def test_failure_rolls_back_all_views_and_retains_generic_audit(database: Engine) -> None:
    store_id = seed(database)
    refresh_analytics(database)
    with database.begin() as c:
        c.execute(update(Store).where(Store.id == store_id).values(name="After refresh"))

    def fail_after_main_view(view: str) -> None:
        if view == "analytics_store_month_changes":
            raise RuntimeError("PRIVATE source value must never be logged")

    with pytest.raises(AnalyticsRefreshError, match="previous results were preserved") as captured:
        refresh_analytics(database, progress=fail_after_main_view)
    assert "PRIVATE" not in str(captured.value)
    assert stored_name(database) == "Before refresh"
    with database.connect() as c:
        audit = c.execute(
            select(AnalyticsRefreshRun.status, AnalyticsRefreshRun.error_message).order_by(
                AnalyticsRefreshRun.started_at.desc()
            )
        ).first()
        assert audit is not None and audit.status == "failed"
        assert "PRIVATE" not in audit.error_message
    refresh_analytics(database)
    assert stored_name(database) == "After refresh"


def test_concurrent_readers_and_source_snapshot_are_consistent(database: Engine) -> None:
    store_id = seed(database)
    refresh_analytics(database)

    def concurrent_work(view: str) -> None:
        if view == ANALYTICAL_VIEWS[0]:
            with pytest.raises(AnalyticsRefreshError, match="already running"):
                refresh_analytics(database)
            # Commit during a refresh: all analytical views must still use the
            # source snapshot captured before this source transaction.
            with database.begin() as c:
                c.execute(update(Store).where(Store.id == store_id).values(name="Later source"))
            import_success(database)
        if view == ANALYTICAL_VIEWS[-1]:
            with database.connect() as c:
                c.execute(text("SET statement_timeout = 1000"))
                assert (
                    c.scalar(text("SELECT current_store_name FROM analytics_store_month"))
                    == "Before refresh"
                )

    refresh_analytics(database, progress=concurrent_work)
    assert stored_name(database) == "Before refresh"
    assert analytics_status(database)["state"] == "stale"
    refresh_analytics(database)
    assert stored_name(database) == "Later source"
    assert analytics_status(database)["state"] == "current"


def test_first_refresh_failure_leaves_snapshot_uninitialized(database: Engine) -> None:
    seed(database)

    def fail(view: str) -> None:
        if view == ANALYTICAL_VIEWS[-1]:
            raise RuntimeError("synthetic failure")

    with pytest.raises(AnalyticsRefreshError):
        refresh_analytics(database, progress=fail)
    assert analytics_status(database)["state"] == "uninitialized"
    with database.connect() as c:
        assert not c.scalar(
            text("SELECT bool_or(ispopulated) FROM pg_matviews WHERE schemaname=current_schema()")
        )
    refresh_analytics(database)
    assert analytics_status(database)["state"] == "current"
