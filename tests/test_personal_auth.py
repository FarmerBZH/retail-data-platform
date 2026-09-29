"""Synthetic personal login, PKCE, expiry and native-vault boundary tests."""

from __future__ import annotations

import base64
import hashlib
import json
import time
from collections.abc import Iterator
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from keyring.backend import KeyringBackend
from test_api import token

from retail_data_platform.api.auth import TokenVerifier
from retail_data_platform.personal_auth.client import LoginRequired, PersonalClient
from retail_data_platform.personal_auth.config import ClientSettings
from retail_data_platform.personal_auth.login import (
    authorization_request,
    callback_code,
    exchange_code,
)
from retail_data_platform.personal_auth.vault import SERVICE, system_vault


class MemoryVault(KeyringBackend):
    """Test-only synthetic vault, never installed as a production fallback."""

    priority = 1

    def __init__(self) -> None:
        self.values: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.values.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.values[service, username] = password

    def delete_password(self, service: str, username: str) -> None:
        self.values.pop((service, username), None)


@pytest.fixture
def settings() -> ClientSettings:
    return ClientSettings(
        "https://identity.example.test",
        "retail-api",
        "https://identity.example.test/jwks",
        "retail-personal",
        "https://identity.example.test/auth",
        "https://identity.example.test/token",
        "https://api.example.test",
    )


@pytest.fixture(scope="module")
def key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def client(settings: ClientSettings, key: rsa.RSAPrivateKey) -> Iterator[PersonalClient]:
    with (
        patch.object(TokenVerifier, "signing_key", return_value=key.public_key()),
        PersonalClient(
            settings,
            vault=MemoryVault(),
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"items": []})),
        ) as client,
    ):
        yield client


def test_pkce_forces_personal_login(settings: ClientSettings) -> None:
    url, state, verifier = authorization_request(settings)
    params = parse_qs(urlsplit(url).query)
    assert params["prompt"] == ["login"] and params["max_age"] == ["0"]
    assert params["scope"] == ["openid data:read operations:read"]
    assert params["response_type"] == ["code"]
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    assert params["code_challenge"] == [expected]
    assert params["code_challenge_method"] == ["S256"]
    assert params["state"] == [state] and len(state) >= 43
    assert params["redirect_uri"] == ["http://127.0.0.1:8765/callback"]
    assert state != authorization_request(settings)[1]
    assert "password" not in params and "client_secret" not in params


@pytest.mark.parametrize(
    "mutation", ["wrong_state", "wrong_issuer", "duplicate", "wrong_path", "no_code"]
)
def test_callback_rejects_substitution(settings: ClientSettings, mutation: str) -> None:
    values = {"state": "synthetic-state", "iss": settings.issuer, "code": "synthetic-code"}
    if mutation == "wrong_state":
        values["state"] = "wrong"
    if mutation == "wrong_issuer":
        values["iss"] = "https://evil.test"
    if mutation == "no_code":
        del values["code"]
    path = ("/wrong" if mutation == "wrong_path" else "/callback") + "?" + urlencode(values)
    if mutation == "duplicate":
        path += "&state=synthetic-state"
    with pytest.raises(ValueError):
        callback_code(path, "synthetic-state", settings.issuer)


def test_callback_accepts_only_correlated_result(settings: ClientSettings) -> None:
    values = {"state": "synthetic", "iss": settings.issuer, "code": "synthetic-code"}
    assert (
        callback_code("/callback?" + urlencode(values), "synthetic", settings.issuer)
        == "synthetic-code"
    )
    values.pop("code")
    values["error"] = "access_denied"
    assert callback_code("/callback?" + urlencode(values), "synthetic", settings.issuer) is None


def test_save_use_expire_without_network_or_refresh(
    client: PersonalClient, key: rsa.RSAPrivateKey
) -> None:
    value = token(key)
    client.save(value)
    assert client.access_token() == value
    stored = json.loads(client.vault.get_password(SERVICE, client.settings.vault_account) or "{}")
    assert set(stored) == {"access_token", "expires_at"}
    assert client.get("/v1/resources").json() == {"items": []}
    with (
        patch("time.time", return_value=stored["expires_at"] + 1),
        patch.object(client.http, "get") as get,
    ):
        with pytest.raises(LoginRequired):
            client.get("/v1/resources")
        get.assert_not_called()
    assert client.vault.get_password(SERVICE, client.settings.vault_account) is None


@pytest.mark.parametrize(
    "claims",
    [
        {"auth_time": None},
        {"auth_time": int(time.time()) - 86401},
        {"auth_time": int(time.time()) + 1000},
        {"auth_time": True},
        {"azp": "service-account"},
        {"exp": int(time.time()) + 90000},
    ],
)
def test_nonpersonal_sessions_rejected(
    client: PersonalClient, key: rsa.RSAPrivateKey, claims: dict[str, object]
) -> None:
    with pytest.raises(HTTPException):
        client.save(token(key, **claims))
    assert client.vault.get_password(SERVICE, client.settings.vault_account) is None


def test_missing_session_never_opens_browser(client: PersonalClient) -> None:
    with patch("webbrowser.open") as browser, patch.object(client.http, "get") as get:
        with pytest.raises(LoginRequired):
            client.get("/v1/resources")
        browser.assert_not_called()
        get.assert_not_called()


def test_exchange_uses_only_code_and_pkce(client: PersonalClient, key: rsa.RSAPrivateKey) -> None:
    with patch.object(
        client.http,
        "post",
        return_value=httpx.Response(
            200, json={"access_token": token(key), "token_type": "Bearer", "id_token": "discarded"}
        ),
    ) as post:
        exchange_code(client, "synthetic-code", "synthetic-verifier")
    sent = post.call_args.kwargs["data"]
    assert sent["grant_type"] == "authorization_code"
    assert sent["code_verifier"] == "synthetic-verifier"
    assert set(sent) == {"grant_type", "code", "redirect_uri", "client_id", "code_verifier"}
    assert "discarded" not in (
        client.vault.get_password(SERVICE, client.settings.vault_account) or ""
    )


def test_provider_refresh_token_is_rejected(client: PersonalClient, key: rsa.RSAPrivateKey) -> None:
    with (
        patch.object(
            client.http,
            "post",
            return_value=httpx.Response(
                200,
                json={
                    "access_token": token(key),
                    "token_type": "Bearer",
                    "refresh_token": "synthetic-private",
                },
            ),
        ),
        pytest.raises(RuntimeError) as caught,
    ):
        exchange_code(client, "code", "verifier")
    assert "synthetic-private" not in str(caught.value)
    assert client.vault.get_password(SERVICE, client.settings.vault_account) is None


def test_redirect_and_unauthorized_never_renew(
    client: PersonalClient, key: rsa.RSAPrivateKey
) -> None:
    client.save(token(key))
    with (
        patch.object(
            client.http,
            "get",
            return_value=httpx.Response(302, headers={"Location": "https://evil.test"}),
        ),
        patch.object(client.http, "post") as post,
    ):
        with pytest.raises(RuntimeError, match="302"):
            client.get("/v1/resources")
        post.assert_not_called()
    with (
        patch.object(client.http, "get", return_value=httpx.Response(401)),
        patch.object(client.http, "post") as post,
    ):
        with pytest.raises(LoginRequired):
            client.get("/v1/resources")
        post.assert_not_called()
    assert client.vault.get_password(SERVICE, client.settings.vault_account) is None


@pytest.mark.parametrize(
    "path",
    [
        "https://evil.test/v1/stores",
        "//evil.test/v1/stores",
        "/v1/../evil",
        "/v1/%2e%2e/evil",
        "/v1/\\evil",
    ],
)
def test_no_token_to_other_destinations(client: PersonalClient, path: str) -> None:
    with pytest.raises(ValueError):
        client.get(path)


def test_no_plaintext_vault_fallback() -> None:
    with (
        patch("sys.platform", "unsupported"),
        pytest.raises(RuntimeError, match="credential vault"),
    ):
        system_vault()


def test_logout_only_removes_selected_context(
    client: PersonalClient, key: rsa.RSAPrivateKey
) -> None:
    client.save(token(key))
    client.vault.set_password(SERVICE, "another-context", "synthetic-other")
    client.logout()
    assert client.vault.get_password(SERVICE, client.settings.vault_account) is None
    assert client.vault.get_password(SERVICE, "another-context") == "synthetic-other"


def test_cli_expiry_exit_code_has_no_token(
    client: PersonalClient, capsys: pytest.CaptureFixture[str]
) -> None:
    from retail_data_platform.personal_auth.cli import main

    with (
        patch("retail_data_platform.personal_auth.cli.PersonalClient", return_value=client),
        patch("sys.argv", ["retail-auth", "get", "/v1/resources"]),
    ):
        assert main() == 2
    output = capsys.readouterr()
    assert not output.out and "retail-auth login" in output.err


def test_api_refuses_missing_personal_claims(
    client: PersonalClient, key: rsa.RSAPrivateKey
) -> None:
    import jwt

    claims = jwt.decode(token(key), options={"verify_signature": False})
    for field in ("auth_time", "azp"):
        incomplete = {k: v for k, v in claims.items() if k != field}
        value = jwt.encode(
            incomplete, key, algorithm="RS256", headers={"typ": "at+jwt", "kid": "test"}
        )
        with pytest.raises(HTTPException) as caught:
            client.save(value)
        assert caught.value.status_code == 401


def test_personal_deadline_even_if_exp_is_later(
    client: PersonalClient, key: rsa.RSAPrivateKey
) -> None:
    now = int(time.time())
    value = token(key, auth_time=now - 30, iat=now, exp=now + 86400)
    client.save(value)
    session = json.loads(client.vault.get_password(SERVICE, client.settings.vault_account) or "{}")
    assert session["expires_at"] == now + 86370
    with patch("time.time", return_value=now + 86370):
        with pytest.raises(HTTPException) as caught:
            client.verifier.verify(value)
        assert caught.value.status_code == 401
