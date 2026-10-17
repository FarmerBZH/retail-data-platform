"""Shared API fixtures with module-scoped disposable PostgreSQL schemas."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, insert, text
from sqlalchemy.engine import make_url

from retail_data_platform.analytics import _refresh_views
from retail_data_platform.api.app import create_app
from retail_data_platform.api.auth import TokenVerifier
from retail_data_platform.api.config import Settings
from retail_data_platform.api.database import (
    create_read_engine,
    grant_sql,
)
from retail_data_platform.database.models import (
    ImportRun,
    Product,
    RegisterObservation,
    Store,
    StoreActivityMetric,
    StoreTypologyValue,
    TypologySnapshot,
)


@pytest.fixture
def settings() -> Settings:
    return Settings(
        "postgresql+psycopg://synthetic:synthetic@127.0.0.1/synthetic",
        "https://identity.example.test",
        "retail-api",
        "https://identity.example.test/jwks",
        hosts=("testserver",),
        origins=("https://frontend.example.test",),
    )


@pytest.fixture(scope="module")
def key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def client(settings: Settings, key: rsa.RSAPrivateKey) -> Iterator[TestClient]:
    # Unit tests isolate startup privileges; integration tests run the real startup.
    with (
        patch("retail_data_platform.api.app.validate_database"),
        patch.object(TokenVerifier, "signing_key", return_value=key.public_key()),
        TestClient(create_app(settings)) as client,
    ):
        yield client


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
