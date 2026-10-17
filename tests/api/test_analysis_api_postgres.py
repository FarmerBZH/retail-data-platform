"""Real HTTP/PostgreSQL analysis, synthetic fixtures and restricted database authority."""

from collections.abc import Iterator
from dataclasses import replace
from datetime import date
from decimal import Decimal
from typing import Any, cast
from unittest.mock import patch
from uuid import UUID, uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, delete, insert, text, update
from sqlalchemy.exc import DBAPIError

from retail_data_platform.analytics import refresh_analytics
from retail_data_platform.api.analysis import PREFIX, _summary
from retail_data_platform.api.app import create_app
from retail_data_platform.api.auth import TokenVerifier
from retail_data_platform.api.config import Settings
from retail_data_platform.api.database import analysis_connection, grant_sql, validate_database
from retail_data_platform.api.limits import ReadBudget
from retail_data_platform.database.models import (
    AnalyticsRefreshRun,
    ImportRun,
    RegisterObservation,
    Store,
    StoreActivityMetric,
)
from tests.support.tokens import token

WINDOW = {"period_from": "2025-02-01", "period_to": "2025-02-01"}
PAIR = {"scope": "selection", "store_ids": [str(UUID(int=1)), str(UUID(int=2))]}


@pytest.fixture(scope="module")
def seeded(database: tuple[Settings, Engine, Engine]) -> tuple[Settings, Engine, Engine]:
    _, admin, _ = database
    with admin.begin() as c:
        c.execute(delete(RegisterObservation))
        c.execute(delete(StoreActivityMetric))
        c.execute(
            insert(Store),
            [
                {"id": UUID(int=i), "source_key": f"extra-{i}", "name": f"Synthetic {i}"}
                for i in range(5, 8)
            ],
        )
        c.execute(update(Store).values(region_code="R-A", retailer_name="Brand"))
        c.execute(
            update(Store)
            .where(Store.id == UUID(int=2))
            .values(region_code="R-B", is_active=False, name="Literal %_ \\ store")
        )
        for i in range(1, 8):
            for month in (1, 2):
                if i == 2 and month == 2:
                    continue
                amount = ("200" if i == 2 else "100") if month == 1 else ("120" if i == 1 else "0")
                c.execute(
                    insert(RegisterObservation).values(
                        id=uuid4(),
                        period=date(2025, month, 1),
                        source_kind="monthly",
                        source_store_reference="synthetic",
                        store_id=UUID(int=i),
                        store_match_status="matched",
                        store_match_method="synthetic",
                        source_gtin="12345678",
                        product_id=UUID(int=100),
                        product_match_status="matched",
                        revenue_value=Decimal(amount),
                        units_sold=0 if amount == "0" else 2,
                    )
                )
    refresh_analytics(admin)
    return database


@pytest.fixture(scope="module")
def http(seeded: tuple[Settings, Engine, Engine]) -> Iterator[TestClient]:
    settings, _, _ = seeded
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with (
        patch.object(TokenVerifier, "signing_key", return_value=key.public_key()),
        TestClient(create_app(settings)) as client,
    ):
        client.headers["Authorization"] = "Bearer " + token(key)
        yield client


@pytest.fixture(autouse=True)
def budget(http: TestClient) -> None:
    cast(FastAPI, http.app).state.budget = ReadBudget()


def get(http: TestClient, route: str, **params: Any) -> dict[str, Any]:
    response = http.get(f"{PREFIX}/{route}", params=params)
    assert response.status_code == 200, response.text
    assert response.headers["Cache-Control"] == "no-store"
    return cast(dict[str, Any], response.json())


def test_summary_oracle_and_projection(http: TestClient) -> None:
    result = get(http, "summary", **WINDOW, **PAIR)
    revenue = result["metrics"]["revenue"]
    assert revenue["current"] == {
        "value": None,
        "partial": "120.00",
        "covered_cell_count": 1,
        "expected_cell_count": 2,
    }
    assert Decimal(revenue["reference"]["value"]) == 300
    assert revenue["change"]["difference"] is None
    cohort = revenue["cohort"]
    assert cohort["store_count"] == 1 and cohort["excluded_store_count"] == 1
    assert Decimal(cohort["change"]["difference"]) == 20
    assert Decimal(cohort["change"]["ratio"]) == Decimal("0.2")
    assert Decimal(result["revenue_contribution_sum"]) == 20
    assert result["context"]["scope"]["scope_store_count"] == 2
    assert result["context"]["window"]["months"] == 1
    assert result["context"]["reference"]["start"] == "2025-01-01"
    assert result["context"]["freshness"]["state"] == "current"
    for secret in ("source_run_ids", "source_key", "source_file_name", "error_message"):
        assert secret not in str(result)


@pytest.mark.parametrize("sort", ["revenue", "revenue_change"])
@pytest.mark.parametrize("direction", ["asc", "desc"])
def test_two_pages_rank_over_whole_scope(http: TestClient, sort: str, direction: str) -> None:
    first = get(http, "ranking", **WINDOW, sort=sort, direction=direction, limit=2)
    items = list(first["items"])
    cursor = first["next_cursor"]
    pub = first["context"]["publication_id"]
    while cursor:
        page = get(
            http,
            "ranking",
            **WINDOW,
            sort=sort,
            direction=direction,
            limit=2,
            after=cursor,
            publication_id=pub,
        )
        items.extend(page["items"])
        cursor = page["next_cursor"]
    expected = [1, 3, 4, 5, 6, 7, 2] if direction == "desc" else [3, 4, 5, 6, 7, 1, 2]
    assert [UUID(row["store_id"]).int for row in items] == expected
    assert [row["rank"] for row in items] == list(range(1, 8))
    assert items[-1]["revenue_change"] is None
    assert items[-1]["exclusion_reason"] == "missing_measure"
    assert sum(Decimal(row["revenue_change"]) for row in items[:-1]) == -480
    wrong = http.get(
        f"{PREFIX}/ranking",
        params={
            **WINDOW,
            "sort": sort,
            "direction": "asc" if direction == "desc" else "desc",
            "limit": 2,
            "publication_id": pub,
            "after": first["next_cursor"],
        },
    )
    assert wrong.status_code == 422


def test_series_and_seven_store_pages_keep_total_scope(http: TestClient) -> None:
    series = get(http, "series", **WINDOW)
    assert len(series["items"]) == 1
    point = series["items"][0]
    assert point["reference_period"] == "2025-01-01"
    assert point["metrics"]["revenue"]["cohort_store_count"] == 6
    first = get(http, "store-series", **WINDOW)
    assert len(first["items"]) == 6
    assert first["context"]["scope"]["scope_store_count"] == 7
    second = get(
        http,
        "store-series",
        **WINDOW,
        after=first["next_cursor"],
        publication_id=first["context"]["publication_id"],
    )
    assert len(second["items"]) == 1 and second["next_cursor"] is None
    assert second["context"]["scope"]["scope_store_count"] == 7
    assert {item["store"]["store_id"] for item in first["items"] + second["items"]} == {
        str(UUID(int=i)) for i in range(1, 8)
    }


def test_discovery_options_availability_and_scope_intersection(http: TestClient) -> None:
    assert len(get(http, "stores", q="%_")["items"]) == 1
    assert get(http, "stores", q="' OR 1=1 --")["items"] == []
    assert get(http, "stores", retailer_name="' OR 1=1 --")["items"] == []
    assert len(get(http, "stores", activity_status="inactive")["items"]) == 1
    options = get(http, "dimensions", dimension="region_code", limit=1)
    assert options["items"] == [{"value": "R-A"}]
    assert options["missing_store_count"] == 0
    second = get(
        http,
        "dimensions",
        dimension="region_code",
        limit=1,
        publication_id=options["context"]["publication_id"],
        after=options["next_cursor"],
    )
    assert second["items"] == [{"value": "R-B"}]
    bounds = get(http, "availability", **PAIR)
    assert bounds["context"]["window"] is None
    register = next(item for item in bounds["items"] if item["dataset"] == "register")
    assert register["first_period"] == "2025-01-01" and register["months"] == []
    result = get(http, "availability", **WINDOW, **PAIR)
    register = next(item for item in result["items"] if item["dataset"] == "register")
    assert register["months"][0]["source_row_count"] == 1
    shelf = next(item for item in result["items"] if item["dataset"] == "shelf")
    assert shelf["first_period"] is None
    assert shelf["months"][0]["source_row_count"] is None
    assert shelf["months"][0]["has_observation"] is False
    summary = get(http, "summary", **WINDOW, **PAIR, region_code="R-A")
    scope = summary["context"]["scope"]
    assert scope["requested_store_count"] == scope["resolved_store_count"] == 2
    assert scope["filtered_out_store_count"] == scope["scope_store_count"] == 1
    empty = get(http, "summary", **WINDOW, region_code="no match")
    assert empty["metrics"]["revenue"]["current"]["expected_cell_count"] == 0
    assert empty["metrics"]["revenue"]["current"]["value"] is None
    bad = http.get(
        f"{PREFIX}/summary",
        params={**WINDOW, "scope": "selection", "store_ids": str(UUID(int=999))},
    )
    assert bad.status_code == 422 and str(UUID(int=999)) not in bad.text


def test_snapshot_coherence_and_changed_publication(
    http: TestClient,
    seeded: tuple[Settings, Engine, Engine],
) -> None:
    _, admin, _ = seeded
    first = get(http, "stores", limit=1)
    old_pub = first["context"]["publication_id"]
    with admin.begin() as c:
        c.execute(
            update(Store).where(Store.id == UUID(int=1)).values(name="Changed synthetic name")
        )
    try:
        assert get(http, "stores", limit=1)["items"][0]["name"] == first["items"][0]["name"]

        def refresh_during_summary(reader: Any) -> dict[str, Any]:
            refresh_analytics(admin)
            return _summary(reader)

        with patch(
            "retail_data_platform.api.analysis._summary", side_effect=refresh_during_summary
        ):
            current = get(http, "summary", **WINDOW, publication_id=old_pub)
        assert current["context"]["publication_id"] == old_pub
        assert current["metrics"]["revenue"]["cohort"]["store_count"] == 6
        changed = http.get(
            f"{PREFIX}/stores",
            params={"limit": 1, "after": first["next_cursor"], "publication_id": old_pub},
        )
        assert changed.status_code == 409 and changed.json() == {"error": "publication_changed"}
        assert get(http, "stores", limit=1)["items"][0]["name"] == "Changed synthetic name"
    finally:
        with admin.begin() as c:
            c.execute(
                update(Store).where(Store.id == UUID(int=1)).values(name=first["items"][0]["name"])
            )
        refresh_analytics(admin)


def test_stale_failed_refresh_and_uninitialized(
    http: TestClient,
    seeded: tuple[Settings, Engine, Engine],
) -> None:
    _, admin, _ = seeded
    iid = uuid4()
    with admin.begin() as c:
        c.execute(
            insert(ImportRun).values(
                id=iid,
                dataset="synthetic",
                source_file_name="synthetic",
                source_sha256="f" * 64,
                status="succeeded",
            )
        )
    try:
        stale = get(http, "stores")
        assert stale["context"]["freshness"]["state"] == "stale"

        def fail(view: str) -> None:
            raise RuntimeError("synthetic-private-error")

        from retail_data_platform.analytics import AnalyticsRefreshError

        with pytest.raises(AnalyticsRefreshError):
            refresh_analytics(admin, progress=fail)
        old = get(http, "stores")
        assert old["context"]["freshness"]["last_attempt_status"] == "failed"
        assert old["context"]["publication_id"] == stale["context"]["publication_id"]
        with admin.begin() as c:
            c.execute(delete(AnalyticsRefreshRun).where(AnalyticsRefreshRun.status == "succeeded"))
        response = http.get(f"{PREFIX}/stores")
        assert response.status_code == 503 and response.json() == {
            "error": "analytics_uninitialized"
        }
    finally:
        with admin.begin() as c:
            c.execute(delete(ImportRun).where(ImportRun.id == iid))
        refresh_analytics(admin)


def test_analysis_grants_isolation_and_startup_fail_closed(
    seeded: tuple[Settings, Engine, Engine],
) -> None:
    settings, admin, reader = seeded
    validate_database(reader, settings.schema)
    with analysis_connection(reader) as c:
        assert c.scalar(text("SHOW transaction_isolation")) == "repeatable read"
        assert c.scalar(text("SHOW transaction_read_only")) == "on"
        assert c.scalar(text("SHOW statement_timeout")) == "5s"
        assert c.execute(text("SELECT name FROM analytics_store_scope LIMIT 1")).first()
    for relation in ("analytics_store_scope", "analytics_store_dataset_month"):
        with reader.begin() as c, pytest.raises(DBAPIError):
            c.execute(text(f"DELETE FROM {relation}"))
    with admin.begin() as c:
        role = c.scalar(text("SELECT current_user"))
        assert role is not None
        # Resolve generated reader identity without exposing credentials.
        from sqlalchemy.engine import make_url

        username = make_url(settings.database_url).username
        assert username is not None
        c.exec_driver_sql(
            f'REVOKE SELECT (name) ON "{settings.schema}".analytics_store_scope FROM "{username}"'
        )
    try:
        with pytest.raises(RuntimeError, match="column grants"):
            validate_database(reader, settings.schema)
    finally:
        with admin.begin() as c:
            c.exec_driver_sql(
                f'GRANT SELECT (name) ON "{settings.schema}".analytics_store_scope TO "{username}"'
            )
    with admin.begin() as c:
        c.exec_driver_sql(
            f'ALTER MATERIALIZED VIEW "{settings.schema}".analytics_store_scope '
            f'OWNER TO "{username}"'
        )
    try:
        with pytest.raises(RuntimeError, match="writable"):
            validate_database(reader, settings.schema)
    finally:
        with admin.begin() as c:
            c.exec_driver_sql(
                f'ALTER MATERIALIZED VIEW "{settings.schema}".analytics_store_scope '
                f'OWNER TO "{role}"'
            )
            for statement in grant_sql(username, settings.schema).split(";"):
                if statement.strip():
                    c.exec_driver_sql(statement)


def test_response_bound_failure_and_budget(http: TestClient) -> None:
    state = cast(FastAPI, http.app).state
    settings = state.settings
    state.settings = replace(settings, response_bytes=1024)
    try:
        response = http.get(
            f"{PREFIX}/series", params={"period_from": "2025-01-01", "period_to": "2025-12-01"}
        )
        assert response.status_code == 413 and response.headers["Cache-Control"] == "no-store"
    finally:
        state.settings = settings
    from sqlalchemy.exc import OperationalError

    with patch(
        "retail_data_platform.api.analysis.analysis_connection",
        side_effect=OperationalError("synthetic-private", {}, Exception("private")),
    ):
        failure = http.get(f"{PREFIX}/stores")
    assert failure.status_code == 503 and "private" not in failure.text
    state.budget = ReadBudget()
    for _ in range(120):
        state.budget.consume("synthetic")
    assert http.get(f"{PREFIX}/stores").status_code == 429


@pytest.mark.parametrize("cancel", [False, True])
def test_sql_timeout_and_cancellation_roll_back_and_release_connection(
    http: TestClient,
    seeded: tuple[Settings, Engine, Engine],
    cancel: bool,
) -> None:
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    from time import monotonic

    _, admin, _ = seeded
    started = Event()
    backend: list[int] = []

    def slow(reader: Any) -> dict[str, Any]:
        if not cancel:
            reader.connection.execute(text("SET LOCAL statement_timeout=20"))
        backend.append(reader.connection.scalar(text("SELECT pg_backend_pid()")))
        started.set()
        reader.connection.execute(text("SELECT pg_sleep(5)"))
        return _summary(reader)

    with (
        patch("retail_data_platform.api.analysis._summary", side_effect=slow),
        ThreadPoolExecutor(max_workers=1) as worker,
    ):
        future = worker.submit(http.get, f"{PREFIX}/summary", params=WINDOW)
        assert started.wait(3)
        if cancel:
            deadline = monotonic() + 3
            while True:
                with admin.connect() as c:
                    active = c.scalar(
                        text(
                            "SELECT state='active' AND query LIKE 'SELECT pg_sleep%' "
                            "FROM pg_stat_activity WHERE pid=:pid"
                        ),
                        {"pid": backend[0]},
                    )
                    if active:
                        assert c.scalar(text("SELECT pg_cancel_backend(:pid)"), {"pid": backend[0]})
                        break
                assert monotonic() < deadline
                Event().wait(0.01)
        response = future.result(timeout=8)
    assert response.status_code == 503
    assert response.json() == {"error": "database_unavailable"}
    assert response.headers["Cache-Control"] == "no-store"
    assert get(http, "stores", limit=1)["items"]


def test_measured_zero_negative_and_ambiguity_match_sql_oracle(
    http: TestClient,
    seeded: tuple[Settings, Engine, Engine],
) -> None:
    _, admin, _ = seeded
    oid = uuid4()
    with admin.begin() as c:
        c.execute(
            insert(RegisterObservation).values(
                id=oid,
                period=date(2025, 2, 1),
                source_kind="monthly",
                source_store_reference="synthetic",
                store_id=UUID(int=2),
                store_match_status="matched",
                store_match_method="synthetic",
                source_gtin="12345678",
                product_id=UUID(int=100),
                product_match_status="matched",
                revenue_value=Decimal("0"),
                units_sold=0,
            )
        )
    try:
        refresh_analytics(admin)
        zero = get(http, "summary", **WINDOW, **PAIR)["metrics"]["revenue"]
        assert Decimal(zero["current"]["value"]) == 120
        assert Decimal(zero["change"]["difference"]) == -180
        assert Decimal(zero["change"]["ratio"]) == Decimal("-0.6")
        with admin.begin() as c:
            c.execute(
                update(RegisterObservation)
                .where(RegisterObservation.id == oid)
                .values(revenue_value=Decimal("-10"))
            )
        refresh_analytics(admin)
        negative = get(
            http,
            "summary",
            period_from="2025-03-01",
            period_to="2025-03-01",
            scope="selection",
            store_ids=str(UUID(int=2)),
        )
        assert negative["metrics"]["revenue"]["change"]["reference_state"] == "negative"
        assert negative["metrics"]["revenue"]["current"]["value"] is None
        with admin.begin() as c:
            c.execute(
                insert(RegisterObservation).values(
                    id=uuid4(),
                    period=date(2025, 2, 1),
                    source_kind="supplement",
                    source_store_reference="synthetic",
                    store_id=UUID(int=2),
                    store_match_status="matched",
                    store_match_method="synthetic",
                    source_gtin="12345678",
                    product_id=UUID(int=100),
                    product_match_status="matched",
                    revenue_value=Decimal("1"),
                    units_sold=1,
                )
            )
        refresh_analytics(admin)
        ranking = get(http, "ranking", **WINDOW, **PAIR)
        assert ranking["items"][-1]["exclusion_reason"] == "ambiguous_measure"
    finally:
        with admin.begin() as c:
            c.execute(
                delete(RegisterObservation).where(
                    RegisterObservation.store_id == UUID(int=2),
                    RegisterObservation.period == date(2025, 2, 1),
                )
            )
        refresh_analytics(admin)


def test_synthetic_api_profile_remains_bounded(
    http: TestClient,
    seeded: tuple[Settings, Engine, Engine],
) -> None:
    """A declared synthetic fixture; no production load or p95 claim."""
    import json
    from time import perf_counter

    _, admin, _ = seeded
    ids = [UUID(int=i + 1000) for i in range(300)]
    with admin.begin() as c:
        c.execute(
            insert(Store),
            [
                {
                    "id": sid,
                    "source_key": f"profile-api-{i}",
                    "name": f"Synthetic profile {i}",
                    "retailer_name": f"Brand {i % 3}",
                    "region_code": f"R-{i % 4}",
                    "is_active": i % 5 != 0,
                }
                for i, sid in enumerate(ids)
            ],
        )
        c.execute(
            insert(RegisterObservation),
            [
                {
                    "id": uuid4(),
                    "period": date(2024 + month // 12, month % 12 + 1, 1),
                    "source_kind": "monthly",
                    "source_store_reference": "synthetic profile",
                    "store_id": sid,
                    "store_match_status": "matched",
                    "store_match_method": "synthetic",
                    "source_gtin": "12345678",
                    "product_id": UUID(int=100),
                    "product_match_status": "matched",
                    "revenue_value": Decimal("1"),
                    "units_sold": 1,
                }
                for sid in ids
                for month in range(24)
            ],
        )
    try:
        refresh_analytics(admin)
        measurements = []
        params = {"period_from": "2025-01-01", "period_to": "2025-02-01"}
        for route, extra, expected_items in [
            ("summary", {}, None),
            ("series", {}, 2),
            ("ranking", {"limit": 5}, 5),
            ("store-series", {"limit": 6}, 6),
        ]:
            start = perf_counter()
            response = http.get(f"{PREFIX}/{route}", params={**params, **extra})
            assert response.status_code == 200
            if expected_items is not None:
                assert len(response.json()["items"]) == expected_items
            assert response.json()["context"]["scope"]["scope_store_count"] == 307
            measurements.append(
                {
                    "route": route,
                    "duration_ms": (perf_counter() - start) * 1000,
                    "bytes": len(response.content),
                }
            )
        filtered = get(http, "summary", **params, retailer_name="Brand 0", region_code="R-0")
        assert filtered["context"]["scope"]["scope_store_count"] == 25
        assert Decimal(filtered["metrics"]["revenue"]["current"]["value"]) == 50
        print("SYNTHETIC_ANALYSIS_API_PROFILE " + json.dumps(measurements))
    finally:
        with admin.begin() as c:
            c.execute(delete(RegisterObservation).where(RegisterObservation.store_id.in_(ids)))
            c.execute(delete(Store).where(Store.id.in_(ids)))
        refresh_analytics(admin)
