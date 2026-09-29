"""Opt-in real loopback callback; synthetic provider and in-memory test vault only."""

from __future__ import annotations

import os
import socket
import threading
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from test_api import token
from test_personal_auth import MemoryVault

from retail_data_platform.api.auth import TokenVerifier
from retail_data_platform.personal_auth.client import PersonalClient
from retail_data_platform.personal_auth.config import ClientSettings
from retail_data_platform.personal_auth.login import login


@pytest.mark.skipif(
    os.getenv("TEST_AUTH_LOOPBACK") != "1",
    reason="Set TEST_AUTH_LOOPBACK=1 to bind a synthetic callback",
)
def test_browser_callback_to_vault() -> None:
    with socket.socket() as temporary:
        temporary.bind(("127.0.0.1", 0))
        port = temporary.getsockname()[1]
    settings = ClientSettings(
        "https://identity.example.test",
        "retail-api",
        "https://identity.example.test/jwks",
        "retail-personal",
        "https://identity.example.test/auth",
        "https://identity.example.test/token",
        "https://api.example.test",
        callback_port=port,
    )
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    value = token(key)
    threads: list[threading.Thread] = []
    results: list[int] = []

    def open_browser(url: str) -> bool:
        params = parse_qs(urlsplit(url).query)

        def callback() -> None:
            with httpx.Client(trust_env=False, timeout=5) as browser:
                bad = {"code": "synthetic-code", "state": "wrong", "iss": settings.issuer}
                results.append(
                    browser.get(settings.redirect_uri + "?" + urlencode(bad)).status_code
                )
                good = {**bad, "state": params["state"][0]}
                response = browser.get(settings.redirect_uri + "?" + urlencode(good))
                results.append(response.status_code)
                assert response.headers["cache-control"] == "no-store"
                assert "synthetic-code" not in response.text

        thread = threading.Thread(target=callback)
        threads.append(thread)
        thread.start()
        return True

    with (
        patch.object(TokenVerifier, "signing_key", return_value=key.public_key()),
        PersonalClient(
            settings,
            vault=MemoryVault(),
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200, json={"access_token": value, "token_type": "Bearer"}
                )
            ),
        ) as client,
    ):
        login(client, open_browser=open_browser, announce=lambda message: None, timeout=5)
        for thread in threads:
            thread.join(5)
            assert not thread.is_alive()
        assert results == [400, 200]
        assert client.access_token() == value
        # Cancellation clears the prior session; there is no silent reuse of a saved login.
        with pytest.raises(RuntimeError, match="timed out"):
            login(client, open_browser=lambda url: True, announce=lambda message: None, timeout=0)
        assert (
            client.vault.get_password(
                "retail-data-platform.personal-session.v1", settings.vault_account
            )
            is None
        )
