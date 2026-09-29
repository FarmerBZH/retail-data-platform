"""Synthetic API contract and security tests; no private inputs."""

from __future__ import annotations

import base64
import json
import time
from collections.abc import Iterator
from dataclasses import replace
from typing import Any
from unittest.mock import patch
from uuid import UUID, uuid4

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.dialects.postgresql import dialect

from retail_data_platform.api.app import create_app
from retail_data_platform.api.auth import TokenVerifier
from retail_data_platform.api.config import Settings
from retail_data_platform.api.database import grant_sql
from retail_data_platform.api.query import Query, cursor_for, statement_for
from retail_data_platform.api.resources import RESOURCES
from retail_data_platform.database.analytics import AnalyticsBase
from retail_data_platform.database.base import Base


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


def token(key: rsa.RSAPrivateKey, **claims: Any) -> str:
    now = int(time.time())
    payload = {
        "iss": "https://identity.example.test",
        "aud": "retail-api",
        "sub": "synthetic",
        "iat": now,
        "auth_time": now,
        "azp": "retail-personal",
        "exp": now + 300,
        "scope": "data:read",
        **claims,
    }
    return jwt.encode(payload, key, algorithm="RS256", headers={"typ": "at+jwt", "kid": "test"})


@pytest.fixture
def client(settings: Settings, key: rsa.RSAPrivateKey) -> Iterator[TestClient]:
    # Unit tests isolate startup privileges; integration tests run the real startup.
    with (
        patch("retail_data_platform.api.app.validate_database"),
        patch.object(TokenVerifier, "signing_key", return_value=key.public_key()),
        TestClient(create_app(settings)) as client,
    ):
        yield client


def test_complete_explicit_registry() -> None:
    assert set(RESOURCES) == set(Base.metadata.tables) | set(AnalyticsBase.metadata.tables)
    assert len(RESOURCES) == 24
    for resource in RESOURCES.values():
        assert resource.keys and set(resource.keys) <= set(resource.columns)
        assert not {"source_file_name", "source_sha256", "error_message"} & set(resource.columns)
        assert all(not c.nullable for c in resource.table.primary_key)


@pytest.mark.parametrize(
    "claims",
    [
        {"exp": 1},
        {"iat": int(time.time()) + 1000},
        {"nbf": int(time.time()) + 1000},
        {"iss": "https://wrong.example.test"},
        {"aud": "wrong"},
        {"aud": ["retail-api"]},
        {"sub": ""},
        {"scope": []},
        {"exp": None},
        {"iat": True},
        {"exp": int(time.time()) + 90000},
    ],
)
def test_invalid_claims(settings: Settings, key: rsa.RSAPrivateKey, claims: dict[str, Any]) -> None:
    with patch.object(TokenVerifier, "signing_key", return_value=key.public_key()):
        with pytest.raises(HTTPException) as caught:
            TokenVerifier(settings).verify(token(key, **claims))
        assert caught.value.status_code == 401


def test_24_hour_personal_session_is_accepted(settings: Settings, key: rsa.RSAPrivateKey) -> None:
    with patch.object(TokenVerifier, "signing_key", return_value=key.public_key()):
        now = int(time.time())
        value = token(key, iat=now, auth_time=now, exp=now + 86400)
        assert TokenVerifier(settings).verify(value).subject == "synthetic"
        with pytest.raises(HTTPException) as caught:
            TokenVerifier(settings).verify(token(key, iat=now, auth_time=now, exp=now + 86401))
        assert caught.value.status_code == 401


def test_signature_type_algorithm_and_missing_claim(
    settings: Settings, key: rsa.RSAPrivateKey
) -> None:
    verifier = TokenVerifier(settings)
    payload = jwt.decode(token(key), options={"verify_signature": False})
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    invalid = [
        jwt.encode(payload, other, algorithm="RS256", headers={"typ": "at+jwt", "kid": "test"}),
        jwt.encode(payload, key, algorithm="RS256", headers={"typ": "JWT", "kid": "test"}),
        jwt.encode(
            payload,
            "synthetic-secret-with-at-least-32-characters",
            algorithm="HS256",
            headers={"typ": "at+jwt", "kid": "test"},
        ),
        jwt.encode(payload, key, algorithm="RS256", headers={"typ": "at+jwt"}),
    ]
    del payload["exp"]
    invalid.append(
        jwt.encode(payload, key, algorithm="RS256", headers={"typ": "at+jwt", "kid": "test"})
    )
    with patch.object(verifier, "signing_key", return_value=key.public_key()):
        for value in invalid:
            with pytest.raises(HTTPException) as caught:
                verifier.verify(value)
            assert caught.value.status_code == 401


def test_protected_routes(client: TestClient, key: rsa.RSAPrivateKey) -> None:
    for path in [
        "/v1/resources",
        "/v1/openapi.json",
        "/v1/analytics/status",
        *[f"/v1/data/{name}" for name in RESOURCES],
    ]:
        assert client.get(path).status_code == 401
    assert client.get("/health/live").status_code == 200
    assert client.get("/docs").status_code == 200
    client.headers["Authorization"] = "Bearer " + token(key)
    assert client.get("/v1/data/import_runs").status_code == 403
    resources = client.get("/v1/resources").json()
    assert len(resources) == 22
    schema = client.get("/v1/openapi.json").json()
    assert schema["paths"]["/v1/data/stores"]["get"]["security"] == [{"HTTPBearer": []}]
    assert "source_file_name" not in json.dumps(schema)
    assert client.post("/v1/data/stores", json={"secret": "synthetic"}).status_code == 405
    client.headers["Authorization"] = "Bearer " + token(key, scope="other")
    assert client.get("/v1/resources").status_code == 403


@pytest.mark.parametrize(
    "query",
    [
        "limit=0",
        "limit=201",
        "limit=1&limit=2",
        "sql=SELECT",
        "id=private-input",
        "period_from=2025-01-02",
        "period_from=2025-02-01&period_to=2025-01-01",
        "after=malformed",
        "period_from=2025-01-01",
    ],
)
def test_bad_queries_do_not_touch_database(
    client: TestClient, key: rsa.RSAPrivateKey, query: str
) -> None:
    with patch("retail_data_platform.api.app.read_connection") as connect:
        response = client.get(
            "/v1/data/stores?" + query, headers={"Authorization": "Bearer " + token(key)}
        )
    assert response.status_code == 422
    assert "private-input" not in response.text
    connect.assert_not_called()


def test_headers_cors_hosts_and_query_size(client: TestClient, key: rsa.RSAPrivateKey) -> None:
    response = client.get("/v1/resources", headers={"Origin": "https://frontend.example.test"})
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    UUID(response.headers["X-Request-ID"])
    assert response.headers["Access-Control-Allow-Origin"] == "https://frontend.example.test"
    assert (
        "Access-Control-Allow-Origin"
        not in client.get("/health/live", headers={"Origin": "https://evil.test"}).headers
    )
    assert client.get("/health/live", headers={"Host": "evil.test"}).status_code == 400
    assert client.get("/health/live?x=" + "a" * 10_001).status_code == 414
    assert client.get("/v1/resources?access_token=" + token(key)).status_code == 401


def test_cursor_context_and_bound_sql() -> None:
    resource = RESOURCES["analytics_store_month"]
    store = uuid4()
    query = Query(store_id=store)
    row = {"store_id": store, "period": "2025-01-01"}
    cursor = cursor_for(resource, query, row)
    statement = statement_for(resource, Query(store_id=store, after=cursor))
    sql = str(statement.compile(dialect=dialect()))  # type: ignore[no-untyped-call]
    assert str(store) not in sql and " > " in sql and "OFFSET" not in sql
    with pytest.raises(HTTPException):
        statement_for(resource, Query(after=cursor))
    encoded = base64.urlsafe_b64encode(
        json.dumps(
            {
                "resource": resource.name,
                "filters": query.context(),
                "keys": [str(store), "'); DROP TABLE stores;--"],
            }
        ).encode()
    ).decode()
    with pytest.raises(HTTPException):
        statement_for(resource, Query(store_id=store, after=encoded))


def test_configuration_and_grants(settings: Settings) -> None:
    variations: list[dict[str, Any]] = [
        {"issuer": "http://identity.test"},
        {"hosts": ("*",)},
        {"origins": ("https://frontend.test/path",)},
        {"schema": "x;DROP"},
        {"database_url": "postgresql+psycopg://user:pw@remote.test/db"},
    ]
    for changes in variations:
        with pytest.raises(ValueError):
            replace(settings, **changes)
    sql = grant_sql("synthetic_reader", "synthetic")
    assert sql.count("GRANT SELECT") == 24
    assert "error_message" not in sql
    with pytest.raises(ValueError):
        grant_sql('reader";DROP', "public")


def test_request_budget(client: TestClient, key: rsa.RSAPrivateKey) -> None:
    client.headers["Authorization"] = "Bearer " + token(key)
    for _ in range(120):
        assert client.get("/v1/resources").status_code == 200
    response = client.get("/v1/resources")
    assert response.status_code == 429 and response.headers["Retry-After"] == "60"


def test_budget_capacity_and_expiry() -> None:
    from retail_data_platform.api.limits import ReadBudget

    budget = ReadBudget()
    with patch("retail_data_platform.api.limits.time.monotonic", return_value=100):
        for number in range(4096):
            budget.consume(str(number))
        with pytest.raises(HTTPException) as caught:
            budget.consume("overflow")
        assert caught.value.status_code == 503
    with patch("retail_data_platform.api.limits.time.monotonic", return_value=161):
        budget.consume("overflow")
    assert len(budget.entries) == 1


def test_unknown_key_refresh_is_throttled(settings: Settings, key: rsa.RSAPrivateKey) -> None:
    verifier = TokenVerifier(settings)
    known = jwt.PyJWK.from_dict(
        {
            **json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key())),
            "kid": "test",
            "alg": "RS256",
        }
    )
    with patch.object(verifier.client, "get_signing_keys", return_value=[known]) as fetch:
        for kid in ["missing-one", "missing-two"]:
            with pytest.raises(jwt.InvalidTokenError):
                verifier.signing_key(kid)
        assert sum(call.kwargs.get("refresh", False) for call in fetch.call_args_list) == 1
        assert verifier.signing_key("test") is known.key


def test_jwks_outage_fails_closed(settings: Settings, key: rsa.RSAPrivateKey) -> None:
    with (
        patch.object(
            TokenVerifier, "signing_key", side_effect=jwt.PyJWKClientConnectionError("synthetic")
        ),
        pytest.raises(HTTPException) as caught,
    ):
        TokenVerifier(settings).verify(token(key))
    assert caught.value.status_code == 503 and "synthetic" not in caught.value.detail


def test_real_jwks_selection_and_signature(settings: Settings, key: rsa.RSAPrivateKey) -> None:
    verifier = TokenVerifier(settings)
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update({"kid": "test", "alg": "RS256", "use": "sig"})
    # Substitute only the HTTP document; run real JWK selection, decoding and verification.
    with patch.object(verifier.client, "fetch_data", return_value={"keys": [jwk]}):
        principal = verifier.verify(token(key))
    assert principal.subject == "synthetic" and principal.scopes == frozenset({"data:read"})


def test_configuration_does_not_echo_credentials(settings: Settings) -> None:
    assert settings.database_url not in repr(settings)
    with (
        patch.dict("os.environ", {"API_DATABASE_URL": "synthetic-private-invalid-url"}),
        pytest.raises(RuntimeError, match="Invalid or missing API configuration") as caught,
    ):
        Settings.from_env()
    assert "synthetic-private" not in str(caught.value)


def test_swagger_shell_keeps_schema_protected(client: TestClient) -> None:
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "SwaggerUIBundle" in response.text
    assert "__NONCE__" not in response.text
    assert "persistAuthorization: false" in response.text
    assert "validatorUrl: null" in response.text
    assert 'credentials: "omit"' in response.text
    assert 'integrity="sha384-' in response.text
    assert "localStorage" not in response.text and "sessionStorage" not in response.text
    assert "analytics_store_month" not in response.text
    assert "frame-ancestors 'none'" in response.headers["Content-Security-Policy"]
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert (
        client.get("/docs").headers["Content-Security-Policy"]
        != response.headers["Content-Security-Policy"]
    )
    assert client.get("/v1/openapi.json").status_code == 401
