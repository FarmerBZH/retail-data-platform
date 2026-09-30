"""Real PostgreSQL API tests with disposable synthetic schema and least-privilege role."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from typing import Any, cast
from unittest.mock import patch

import pytest
from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, insert, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError
from test_api import token

from retail_data_platform.analytics import _refresh_views
from retail_data_platform.api.app import create_app
from retail_data_platform.api.auth import TokenVerifier
from retail_data_platform.api.config import Settings
from retail_data_platform.api.database import (
    create_read_engine,
    grant_sql,
    read_connection,
    validate_database,
)
from retail_data_platform.api.resources import RESOURCES
from retail_data_platform.database.models import (
    ImportRun,
    Product,
    RegisterObservation,
    Store,
    StoreActivityMetric,
    StoreTypologyValue,
    TypologySnapshot,
)


@pytest.fixture(scope="module")
def database() -> Iterator[tuple[Settings, Engine, Engine]]:
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL required for PostgreSQL API tests")
    identifier = uuid.uuid4().hex
    schema, role = "api_test_" + identifier, "api_reader_" + identifier
    password = uuid.uuid4().hex
    admin = create_engine(url, connect_args={"options": f"-c search_path={schema},pg_catalog"})
    reader: Engine | None = None
    try:
        with admin.begin() as c:
            c.execute(text(f'CREATE SCHEMA "{schema}"'))
            config = Config("alembic.ini")
            config.attributes["connection"] = c
            command.upgrade(config, "head")
            command.check(config)
            # Generated identifiers and password contain only ASCII alphanumerics/underscores.
            c.exec_driver_sql(f"CREATE ROLE {role} LOGIN PASSWORD '{password}'")
            for sql in grant_sql(role, schema).split(";"):
                if sql.strip():
                    c.exec_driver_sql(sql)
            stores = [uuid.UUID(int=i) for i in range(1, 5)]
            c.execute(
                insert(Store),
                [
                    {"id": sid, "source_key": f"synthetic-{i}", "name": f"Store {i}"}
                    for i, sid in enumerate(stores)
                ],
            )
            c.execute(
                insert(Product),
                {
                    "id": uuid.UUID(int=100),
                    "gtin": "12345678",
                    "internal_code": "synthetic",
                    "name": "Product",
                    "average_price": Decimal("12.30"),
                    "average_price_currency": "EUR",
                },
            )
            c.execute(
                insert(RegisterObservation),
                {
                    "id": uuid.UUID(int=150),
                    "period": date(2025, 1, 1),
                    "source_kind": "monthly",
                    "source_store_reference": "synthetic",
                    "store_id": stores[0],
                    "store_match_status": "matched",
                    "store_match_method": "synthetic",
                    "source_gtin": "12345678",
                    "product_id": uuid.UUID(int=100),
                    "product_match_status": "matched",
                    "revenue_value": Decimal("12.30"),
                    "units_sold": 2,
                },
            )
            c.execute(
                insert(StoreActivityMetric),
                [
                    {
                        "id": uuid.UUID(int=200 + i),
                        "source_key": str(i).zfill(64),
                        "period": date(2025, 1, 1),
                        "store_id": sid,
                        "store_match_status": "matched",
                        "store_match_method": "synthetic",
                        "activity_type": "calls",
                        "activity_count": i,
                        "source_store_reference": "synthetic",
                        "source_store_label": "synthetic",
                    }
                    for i, sid in enumerate(stores)
                ],
            )
            c.execute(
                insert(ImportRun),
                {
                    "id": uuid.UUID(int=500),
                    "dataset": "synthetic",
                    "source_file_name": "synthetic-private-file",
                    "source_sha256": "a" * 64,
                    "status": "failed",
                    "error_message": "synthetic-private-error",
                },
            )
            snapshot = uuid.UUID(int=600)
            c.execute(
                insert(TypologySnapshot),
                {
                    "id": snapshot,
                    "source_key": "b" * 64,
                    "period": date(2025, 1, 1),
                    "store_id": stores[0],
                    "store_match_status": "matched",
                },
            )
            c.execute(
                insert(StoreTypologyValue),
                {
                    "id": uuid.UUID(int=601),
                    "snapshot_id": snapshot,
                    "category_key": "synthetic",
                    "category_name": "synthetic",
                    "typology_value": "synthetic",
                },
            )
            _refresh_views(c)
        settings = Settings(
            make_url(url)
            .set(username=role, password=password)
            .render_as_string(hide_password=False),
            "https://identity.example.test",
            "retail-api",
            "https://identity.example.test/jwks",
            hosts=("testserver",),
            schema=schema,
        )
        reader = create_read_engine(settings)
        yield settings, admin, reader
    finally:
        if reader is not None:
            reader.dispose()
        with admin.begin() as c:
            c.exec_driver_sql(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
            c.exec_driver_sql(f'DROP ROLE IF EXISTS "{role}"')
        admin.dispose()


@pytest.fixture(scope="module")
def api(database: tuple[Settings, Engine, Engine]) -> Iterator[TestClient]:
    settings, _, _ = database
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with (
        patch.object(TokenVerifier, "signing_key", return_value=key.public_key()),
        TestClient(create_app(settings)) as client,
    ):
        client.headers["Authorization"] = "Bearer " + token(key, scope="data:read operations:read")
        yield client


def test_all_resources_and_exact_serialization(api: TestClient) -> None:
    assert len(api.get("/v1/resources").json()) == 28
    for resource in RESOURCES:
        response = api.get(f"/v1/data/{resource}")
        assert response.status_code == 200, (resource, response.text)
        assert set(response.json()) == {"items", "next_cursor"}
    product = api.get("/v1/data/products").json()["items"][0]
    assert product["average_price"] == "12.30"
    assert product["brand"] is None
    audit = api.get("/v1/data/import_runs").text
    assert "synthetic-private" not in audit and "source_sha256" not in audit
    assert api.get("/v1/analytics/status").status_code == 200


def test_every_primary_key_can_select_its_row(api: TestClient) -> None:
    for resource in RESOURCES.values():
        assert set(resource.keys) <= set(resource.filters)
        response = api.get(f"/v1/data/{resource.name}")
        assert response.status_code == 200
        rows = response.json()["items"]
        if not rows:
            continue
        first = rows[0]
        filters: dict[str, str] = {}
        for key in resource.keys:
            if key == "period":
                filters["period_from"] = first[key]
                filters["period_to"] = first[key]
            else:
                filters[key] = str(first[key])
        selected = api.get(f"/v1/data/{resource.name}", params=filters)
        assert selected.status_code == 200, (resource.name, selected.text)
        assert selected.json()["items"] == [first]


@pytest.mark.parametrize(
    "resource", ["stores", "analytics_store_month", "analytics_activity_month"]
)
def test_keyset_pages_and_filters(api: TestClient, resource: str) -> None:
    cursor = None
    ids: list[str] = []
    for _ in range(10):
        params: dict[str, Any] = {"limit": 1}
        if cursor:
            params["after"] = cursor
        response = api.get(f"/v1/data/{resource}", params=params)
        assert response.status_code == 200
        page = response.json()
        ids.extend(row.get("store_id", row.get("id")) for row in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(ids) == len(set(ids)) == 4
    selected = api.get(f"/v1/data/{resource}", params={"store_id": str(uuid.UUID(int=2))})
    assert len(selected.json()["items"]) == 1
    assert (
        api.get(f"/v1/data/{resource}", params={"store_id": str(uuid.UUID(int=99))}).json()["items"]
        == []
    )


def test_privileges_read_only_and_timeouts(database: tuple[Settings, Engine, Engine]) -> None:
    settings, admin, reader = database
    validate_database(reader, settings.schema)
    with pytest.raises(RuntimeError, match="unsafe"):
        validate_database(admin, settings.schema)
    with read_connection(reader) as c:
        assert c.scalar(text("SHOW transaction_read_only")) == "on"
        assert c.scalar(text("SHOW statement_timeout")) == "5s"
        assert c.scalar(text("SHOW lock_timeout")) == "1s"
        with pytest.raises(DBAPIError):
            c.execute(text("DELETE FROM stores"))
    with reader.begin() as c:
        c.execute(text("SET TRANSACTION READ WRITE"))
        with pytest.raises(DBAPIError):
            c.execute(text("UPDATE stores SET name='synthetic'"))
    with reader.begin() as c, pytest.raises(DBAPIError):
        c.execute(text("SELECT source_file_name FROM import_runs"))
    with read_connection(reader) as c:
        c.execute(text("SET LOCAL statement_timeout=20"))
        with pytest.raises(DBAPIError):
            c.execute(text("SELECT pg_sleep(0.1)"))


def test_response_size_and_database_failure(
    api: TestClient, database: tuple[Settings, Engine, Engine]
) -> None:
    from dataclasses import replace

    settings = cast(FastAPI, api.app).state.settings
    cast(FastAPI, api.app).state.settings = replace(settings, response_bytes=1024)
    try:
        response = api.get("/v1/data/stores")
        assert response.status_code == 413
    finally:
        cast(FastAPI, api.app).state.settings = settings
    with patch(
        "retail_data_platform.api.app.read_connection",
        side_effect=DBAPIError("synthetic-private", {}, Exception("synthetic-private")),
    ):
        response = api.get("/v1/data/stores")
    assert response.status_code == 503 and "synthetic-private" not in response.text


def test_typology_store_filter_and_nested_contract(api: TestClient) -> None:
    own = api.get("/v1/data/store_typology_values", params={"store_id": str(uuid.UUID(int=1))})
    other = api.get("/v1/data/store_typology_values", params={"store_id": str(uuid.UUID(int=2))})
    assert len(own.json()["items"]) == 1 and other.json()["items"] == []
    row = api.get(
        "/v1/data/analytics_store_month", params={"store_id": str(uuid.UUID(int=1))}
    ).json()["items"][0]
    row["current_store"]["future_private_field"] = "synthetic-secret"
    row["typology_details"][0]["future_private_field"] = "synthetic-secret"
    serialized = RESOURCES["analytics_store_month"].row_model.model_validate(row).model_dump_json()
    assert "future_private_field" not in serialized and "synthetic-secret" not in serialized


def test_network_resources_coverage_filters_and_nulls(api: TestClient) -> None:
    response = api.get("/v1/data/analytics_network_month", params={"period_from": "2025-01-01"})
    assert response.status_code == 200
    row = response.json()["items"][0]
    assert row["expected_cell_count"] == row["calls_covered_cell_count"] == 4
    assert row["calls"] == "6" and row["revenue"] is None
    assert row["revenue_partial"] == "12.30" and row["revenue_covered_cell_count"] == 1
    assert (
        api.get("/v1/data/analytics_network_overview", params={"scope": "network"}).status_code
        == 200
    )
    assert (
        api.get(
            "/v1/data/analytics_network_overview", params={"period_from": "2025-01-01"}
        ).status_code
        == 422
    )
    assert (
        api.get(
            "/v1/data/analytics_network_month", params={"store_id": str(uuid.UUID(int=1))}
        ).status_code
        == 422
    )
    assert api.get("/v1/data/analytics_network_year").json()["items"][0]["month_count"] == 1
