"""Transactional synthetic analytics fixtures and migration checks."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, create_engine, event, inspect, text
from sqlalchemy.orm import ORMExecuteState, Session

from retail_data_platform.analytics import _refresh_views


@pytest.fixture(scope="module")
def migrated_connection() -> Iterator[Connection]:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for isolated PostgreSQL integration tests")
    engine = create_engine(url)
    schema = "test_analytics_" + uuid.uuid4().hex
    with engine.connect() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20261015_15")
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20260930_14")
        assert "analytics_store_scope" not in inspect(connection).get_materialized_view_names()
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20260927_13")
        assert "analytics_network_month" not in inspect(connection).get_materialized_view_names()
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20260927_12")
        assert not connection.execute(
            text(
                "SELECT ispopulated FROM pg_matviews WHERE schemaname=current_schema() "
                "AND matviewname='analytics_retailer_assortment_month'"
            )
        ).scalar_one()
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20260926_11")
        assert not inspect(connection).get_materialized_view_names()
        assert len(inspect(connection).get_view_names()) == 11
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20260925_10")
        assert not inspect(connection).get_view_names()
        assert not inspect(connection).get_materialized_view_names()
        command.upgrade(config, "head")
        command.check(config)
        try:
            yield connection
        finally:
            # All test data, DDL and schema creation are in the outer transaction.
            connection.rollback()
    engine.dispose()


@pytest.fixture
def session(migrated_connection: Connection) -> Iterator[Session]:
    with Session(migrated_connection, join_transaction_mode="create_savepoint") as session:
        # These tests assert measure semantics after publication. Refresh the
        # synthetic snapshot before each analytical SELECT. Lifecycle/staleness
        # tests use ordinary sessions in test_analytics_refresh instead.
        @event.listens_for(session, "do_orm_execute")
        def refresh_before_read(state: ORMExecuteState) -> None:
            if state.is_select or str(state.statement).lstrip().upper().startswith("SELECT"):
                session.flush()
                _refresh_views(session.connection())

        yield session
        session.rollback()
