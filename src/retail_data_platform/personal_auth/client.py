from __future__ import annotations

import json
import ssl
import time
from typing import Any
from urllib.parse import urlsplit

import httpx
import jwt
from fastapi import HTTPException
from keyring.backend import KeyringBackend

from retail_data_platform.api.auth import MAX_PERSONAL_SESSION_SECONDS, TokenVerifier
from retail_data_platform.personal_auth.config import ClientSettings
from retail_data_platform.personal_auth.vault import SERVICE, erase, system_vault


class LoginRequired(RuntimeError):
    def __init__(self) -> None:
        super().__init__("Personal session missing or expired. Run retail-auth login again.")


class PersonalClient:
    def __init__(
        self,
        settings: ClientSettings | None = None,
        *,
        vault: KeyringBackend | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.settings = settings or ClientSettings.from_env()
        self.vault = vault if vault is not None else system_vault()
        self.verifier = TokenVerifier(self.settings)
        self.http = httpx.Client(
            timeout=10,
            follow_redirects=False,
            trust_env=False,
            verify=ssl.create_default_context(),
            transport=transport,
        )

    def save(self, token: str) -> None:
        self.verifier.verify(token)
        # Signature and claims have just been verified above, including personal auth_time.
        claims = jwt.decode(token, options={"verify_signature": False})
        expires = min(claims["exp"], claims["auth_time"] + MAX_PERSONAL_SESSION_SECONDS)
        self.vault.set_password(
            SERVICE,
            self.settings.vault_account,
            json.dumps({"access_token": token, "expires_at": expires}),
        )

    def access_token(self) -> str:
        value = self.vault.get_password(SERVICE, self.settings.vault_account)
        if value is None:
            raise LoginRequired()
        try:
            session = json.loads(value)
            if not isinstance(session, dict) or type(session.get("expires_at")) is not int:
                raise ValueError()
            if session["expires_at"] <= time.time():
                raise ValueError()
            token = session["access_token"]
            if not isinstance(token, str):
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            self.logout()
            raise LoginRequired() from None
        try:
            self.verifier.verify(token)
        except HTTPException as exc:
            if exc.status_code in {401, 403}:
                self.logout()
                raise LoginRequired() from None
            raise RuntimeError("Identity verification unavailable; no request sent") from None
        return token

    def get(self, path: str, *, params: dict[str, Any] | None = None) -> httpx.Response:
        parsed = urlsplit(path)
        if (
            not path.startswith("/v1/")
            or parsed.scheme
            or parsed.netloc
            or parsed.fragment
            or "\\" in path
            or "%" in path
            or any(p in {".", ".."} for p in parsed.path.split("/"))
        ):
            raise ValueError("Only relative /v1/ API paths are allowed")
        token = self.access_token()
        try:
            response = self.http.get(
                self.settings.api_url.rstrip("/") + path,
                params=params,
                headers={"Authorization": "Bearer " + token},
            )
        except httpx.HTTPError:
            raise RuntimeError("API request failed") from None
        if response.status_code == 401:
            self.logout()
            raise LoginRequired()
        if response.status_code >= 300:
            raise RuntimeError(f"API request rejected (HTTP {response.status_code})")
        return response

    def logout(self) -> None:
        erase(self.vault, self.settings.vault_account)

    def close(self) -> None:
        self.http.close()

    def __enter__(self) -> PersonalClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
