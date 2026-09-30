"""Atomic, auditable refresh of the complete analytical snapshot."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from sqlalchemy import Connection, Engine, insert, select, text, update

from retail_data_platform.database.models import AnalyticsRefreshRun, ImportRun
from retail_data_platform.database.session import create_database_engine

# Dependencies must be refreshed before their consumers.
ANALYTICAL_VIEWS = (
    "analytics_register_product_month",
    "analytics_activity_month",
    "analytics_distribution_product_month",
    "analytics_shelf_category_month",
    "analytics_typology_month",
    "analytics_assortment_candidates",
    "analytics_retailer_assortment_month",
    "analytics_store_category_month",
    "analytics_monthly_link_quality",
    "analytics_store_month",
    "analytics_store_month_changes",
    "analytics_network_month",
    "analytics_network_year",
    "analytics_network_overview",
    "analytics_network_month_changes",
)
LOCK_NAME = "retail_analytics_refresh"


class AnalyticsRefreshError(RuntimeError):
    """A refresh could not publish; no source values are included."""


def _source_run_ids(connection: Connection) -> list[uuid.UUID]:
    return list(
        connection.scalars(
            select(ImportRun.id).where(ImportRun.status == "succeeded").order_by(ImportRun.id)
        )
    )


def _refresh_views(
    connection: Connection,
    progress: Callable[[str], None] | None = None,
) -> None:
    populated = dict(
        connection.execute(
            text(
                "SELECT matviewname, ispopulated FROM pg_matviews "
                "WHERE schemaname = current_schema()"
            )
        )
        .tuples()
        .all()
    )
    if not set(ANALYTICAL_VIEWS) <= populated.keys():
        raise AnalyticsRefreshError("Analytical materialized views are not installed")
    for name in ANALYTICAL_VIEWS:
        if progress:
            progress(name)
        # Concurrent refresh permits readers to retain the previous snapshot.
        # PostgreSQL requires a normal refresh for an unpopulated view.
        concurrently = "CONCURRENTLY " if populated[name] else ""
        connection.execute(text(f"REFRESH MATERIALIZED VIEW {concurrently}{name}"))
        connection.execute(text(f"ANALYZE {name}"))


def refresh_analytics(
    engine: Engine | None = None,
    *,
    progress: Callable[[str], None] | None = None,
) -> None:
    """Publish all views together from one repeatable-read source snapshot.

    Uses a dedicated connection and a session lock taken *before* capturing the
    snapshot. Refuse overlapping refreshes rather than queue a stale snapshot.
    Failure recording uses a separate transaction after the refresh rollback.
    """
    owned_engine = engine is None
    database = engine if engine is not None else create_database_engine()
    try:
        with database.connect() as connection:
            locked = connection.scalar(
                text("SELECT pg_try_advisory_lock(hashtext(:name))"), {"name": LOCK_NAME}
            )
            connection.commit()
            if not locked:
                raise AnalyticsRefreshError("An analytical refresh is already running")
            run_id = uuid.uuid4()
            recorded = False
            try:
                with connection.begin():
                    connection.execute(
                        insert(AnalyticsRefreshRun).values(
                            id=run_id, status="running", started_at=datetime.now(UTC)
                        )
                    )
                recorded = True
                connection.execution_options(isolation_level="REPEATABLE READ")
                with connection.begin():
                    # This first query fixes the snapshot used by every refresh.
                    source_ids = _source_run_ids(connection)
                    captured_at = datetime.now(UTC)
                    _refresh_views(connection, progress)
                    connection.execute(
                        update(AnalyticsRefreshRun)
                        .where(AnalyticsRefreshRun.id == run_id)
                        .values(
                            status="succeeded",
                            source_snapshot_at=captured_at,
                            completed_at=datetime.now(UTC),
                            source_run_ids=source_ids,
                        )
                    )
            except BaseException as error:
                connection.rollback()
                if recorded:
                    with connection.begin():
                        connection.execute(
                            update(AnalyticsRefreshRun)
                            .where(AnalyticsRefreshRun.id == run_id)
                            .values(
                                status="failed",
                                completed_at=datetime.now(UTC),
                                error_message="Analytical refresh failed; publication rolled back",
                            )
                        )
                if isinstance(error, (KeyboardInterrupt, SystemExit)):
                    raise
                raise AnalyticsRefreshError(
                    "Analytical refresh failed; previous results were preserved"
                ) from None
            finally:
                connection.rollback()
                connection.execute(
                    text("SELECT pg_advisory_unlock(hashtext(:name))"), {"name": LOCK_NAME}
                )
                connection.commit()
    finally:
        if owned_engine:
            database.dispose()


def analytics_status(engine: Engine | None = None) -> dict[str, str | None]:
    """Return freshness without exposing source identities or business statistics."""
    owned_engine = engine is None
    database = engine if engine is not None else create_database_engine()
    try:
        with database.connect().execution_options(isolation_level="REPEATABLE READ") as c:
            c.execute(text("SET TRANSACTION READ ONLY"))
            successful = c.execute(
                select(
                    AnalyticsRefreshRun.completed_at,
                    AnalyticsRefreshRun.source_run_ids,
                )
                .where(AnalyticsRefreshRun.status == "succeeded")
                .order_by(AnalyticsRefreshRun.completed_at.desc())
                .limit(1)
            ).first()
            latest = c.scalar(
                select(AnalyticsRefreshRun.status)
                .order_by(AnalyticsRefreshRun.started_at.desc())
                .limit(1)
            )
            populated = dict(
                c.execute(
                    text(
                        "SELECT matviewname, ispopulated FROM pg_matviews "
                        "WHERE schemaname = current_schema()"
                    )
                )
                .tuples()
                .all()
            )
            initialized = successful is not None and all(
                populated.get(name, False) for name in ANALYTICAL_VIEWS
            )
            state = "uninitialized"
            if initialized and successful is not None:
                state = "current" if successful.source_run_ids == _source_run_ids(c) else "stale"
            return {
                "state": state,
                "last_completed_at": successful.completed_at.isoformat() if successful else None,
                "last_attempt_status": latest,
            }
    finally:
        if owned_engine:
            database.dispose()
