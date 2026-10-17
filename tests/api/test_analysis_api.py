"""Hostile query, discovery and authentication tests without a business database."""

from datetime import date
from typing import Any
from unittest.mock import patch
from uuid import UUID

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from retail_data_platform.api.analysis import PREFIX, _cursor, _decode
from retail_data_platform.api.analysis_models import RankingQuery, StoresQuery
from tests.support.tokens import token

ROUTES = ("stores", "dimensions", "availability", "summary", "series", "ranking", "store-series")
WINDOW = "period_from=2025-02-01&period_to=2025-02-01"


def test_analysis_auth_and_openapi(client: TestClient, key: rsa.RSAPrivateKey) -> None:
    for route in ROUTES:
        assert client.get(f"{PREFIX}/{route}").status_code == 401
        response = client.get(
            f"{PREFIX}/{route}", headers={"Authorization": "Bearer " + token(key, scope="other")}
        )
        assert response.status_code == 403
    client.headers["Authorization"] = "Bearer " + token(key)
    schema = client.get("/v1/openapi.json").json()
    for route in ROUTES:
        operation = schema["paths"][f"{PREFIX}/{route}"]["get"]
        assert operation["security"] == [{"HTTPBearer": []}]
        assert "200" in operation["responses"]
        for status in ("401", "403", "409", "413", "414", "422", "429", "500", "503"):
            error_schema = operation["responses"][status]["content"]["application/json"]["schema"]
            assert error_schema == {"$ref": "#/components/schemas/ErrorResponse"}
        assert set(schema["components"]["schemas"]["ErrorResponse"]["properties"]) == {"error"}
        assert all(p["in"] == "query" for p in operation["parameters"])
    assert len(client.get("/v1/resources").json()) == 26
    assert "analytics_store_scope" not in str(schema)
    assert "source_run_ids" in str(schema)  # Existing OPS contract, not an analysis projection.
    for route in ROUTES:
        operation = schema["paths"][f"{PREFIX}/{route}"]["get"]
        assert not any(p["name"] == "sql" for p in operation["parameters"])


@pytest.mark.parametrize(
    "route,query",
    [
        ("stores", "scope=selection"),
        ("stores", "scope=all&store_ids=00000000-0000-0000-0000-000000000001"),
        ("stores", "scope=selection&store_ids=invalid-private-value"),
        ("stores", "scope=selection&" + "&".join(f"store_ids={UUID(int=i)}" for i in range(101))),
        (
            "stores",
            "scope=selection&store_ids=" + str(UUID(int=1)) + "&store_ids=" + str(UUID(int=1)),
        ),
        ("stores", "limit=0"),
        ("stores", "limit=201"),
        ("stores", "limit=1&limit=2"),
        ("stores", "scope=all&scope=selection"),
        ("stores", "q="),
        ("stores", "q=" + "x" * 129),
        ("stores", "retailer_name=" + "x" * 129),
        ("stores", "sql=DROP"),
        ("stores", "after=malformed"),
        ("stores", "after=" + "x" * 8193),
        ("dimensions", ""),
        ("dimensions", "dimension=name"),
        ("summary", ""),
        ("summary", WINDOW + "&comparison=other"),
        ("summary", "period_from=2025-02-02&period_to=2025-02-01"),
        ("summary", "period_from=2025-02-01&period_to=2025-01-01"),
        ("summary", "period_from=2025-01-01&period_to=2035-01-01"),
        ("summary", "period_from=0001-01-01&period_to=0001-01-01"),
        ("summary", WINDOW + "&q=private-value"),
        ("ranking", WINDOW + "&sort=sql"),
        ("ranking", WINDOW + "&direction=sideways"),
        ("ranking", WINDOW + "&after=malformed&publication_id=" + str(UUID(int=1))),
        ("store-series", WINDOW + "&limit=7"),
        ("availability", "period_from=2025-01-01"),
    ],
)
def test_analysis_invalid_queries_do_not_read_database(
    client: TestClient,
    key: rsa.RSAPrivateKey,
    route: str,
    query: str,
) -> None:
    with patch("retail_data_platform.api.analysis.analysis_connection") as connect:
        response = client.get(
            f"{PREFIX}/{route}?{query}", headers={"Authorization": "Bearer " + token(key)}
        )
    assert response.status_code == 422
    assert "private-value" not in response.text
    assert response.headers["Cache-Control"] == "no-store"
    connect.assert_not_called()


def test_cursor_context_is_canonical_and_typed() -> None:
    pub = UUID(int=88)
    ids = [UUID(int=2), UUID(int=1)]
    query = StoresQuery(scope="selection", store_ids=ids, publication_id=pub)
    cursor = _cursor("stores", query, pub, {"store_id": str(ids[0])})
    reordered = StoresQuery(
        scope="selection", store_ids=list(reversed(ids)), publication_id=pub, after=cursor, limit=10
    )
    assert _decode("stores", reordered) == ids[0]
    variations: list[tuple[str, dict[str, Any]]] = [
        ("dimensions", {}),
        ("stores", {"q": "other"}),
        ("stores", {"publication_id": UUID(int=89)}),
        ("stores", {"publication_id": None}),
    ]
    for route, changes in variations:
        from fastapi import HTTPException

        with pytest.raises(HTTPException):
            _decode(route, reordered.model_copy(update=changes))
    ranking = RankingQuery(
        period_from=date(2025, 2, 1),
        period_to=date(2025, 2, 1),
        publication_id=pub,
    )
    for value in ["NaN", "Infinity", "1e9999", "' OR 1=1", 1.5]:
        payload: dict[str, Any] = {"store_id": str(ids[0]), "value": value}
        bad = _cursor("ranking", ranking, pub, payload)
        with pytest.raises(HTTPException):
            _decode("ranking", ranking.model_copy(update={"after": bad}))
