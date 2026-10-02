"""Exercise local Keycloak with disposable synthetic users, then remove them."""

from __future__ import annotations

import html.parser
import os
import secrets
from pathlib import Path
from typing import Any, cast
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
from fastapi import HTTPException
from keyring.backend import KeyringBackend

from retail_data_platform.api.auth import MAX_PERSONAL_SESSION_SECONDS, TokenVerifier
from retail_data_platform.personal_auth.client import PersonalClient
from retail_data_platform.personal_auth.config import ClientSettings
from retail_data_platform.personal_auth.login import authorization_request

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://localhost:8443"
REALM = "retail"
CERT = ROOT / ".env.identity.local-certs/tls.crt"


class MemoryVault(KeyringBackend):
    priority = 1

    def __init__(self) -> None:
        self.data: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.data.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.data[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        del self.data[(service, username)]


class LoginForm(html.parser.HTMLParser):
    action: str | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        fields = dict(attrs)
        if tag == "form" and fields.get("id") == "kc-form-login":
            self.action = fields.get("action")


def require(response: httpx.Response, status: int) -> httpx.Response:
    if response.status_code != status:
        raise RuntimeError(f"Unexpected Keycloak HTTP {response.status_code}")
    return response


def admin_session() -> httpx.Client:
    values = dict(
        line.split("=", 1)
        for line in (ROOT / ".env.identity.local").read_text().splitlines()
        if "=" in line
    )
    client = httpx.Client(base_url=BASE, verify=str(CERT), timeout=15)
    response = require(
        client.post(
            "/realms/master/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": values["KC_BOOTSTRAP_ADMIN_USERNAME"],
                "password": values["KC_BOOTSTRAP_ADMIN_PASSWORD"],
            },
        ),
        200,
    )
    client.headers["Authorization"] = f"Bearer {response.json()['access_token']}"
    return client


def create_user(admin: httpx.Client, username: str, password: str) -> str:
    response = require(
        admin.post(
            f"/admin/realms/{REALM}/users",
            json={
                "username": username,
                "firstName": "Synthetic",
                "lastName": "Reader",
                "email": f"{username}@example.test",
                "enabled": True,
                "credentials": [{"type": "password", "value": password, "temporary": False}],
            },
        ),
        201,
    )
    return response.headers["Location"].rsplit("/", 1)[-1]


def user_token(
    username: str, password: str, *, approved: bool, client_id: str = "retail-personal"
) -> dict[str, Any]:
    settings = ClientSettings(
        issuer=f"{BASE}/realms/{REALM}",
        audience="retail-api",
        jwks_url=f"{BASE}/realms/{REALM}/protocol/openid-connect/certs",
        client_id=client_id,
        authorization_url=f"{BASE}/realms/{REALM}/protocol/openid-connect/auth",
        token_url=f"{BASE}/realms/{REALM}/protocol/openid-connect/token",
        api_url="http://127.0.0.1:8000",
    )
    url, state, verifier = authorization_request(settings)
    with httpx.Client(verify=str(CERT), timeout=15, follow_redirects=False) as browser:
        page = require(browser.get(url), 200)
        form = LoginForm()
        form.feed(page.text)
        if not form.action:
            raise RuntimeError("Keycloak did not present its login form")
        redirect = require(
            browser.post(form.action, data={"username": username, "password": password}),
            302,
        )
        callback = urlsplit(redirect.headers["Location"])
        if callback.scheme != "http" or callback.hostname != "127.0.0.1":
            raise RuntimeError(
                "Unexpected login callback destination: "
                f"{callback.scheme}://{callback.hostname}{callback.path}"
            )
        values = parse_qs(callback.query)
        if values.get("state") != [state] or values.get("iss") != [settings.issuer]:
            raise RuntimeError("Invalid login callback state or issuer")
        code = values.get("code", [None])[0]
        if not code:
            raise RuntimeError("Keycloak returned no authorization code")
        with PersonalClient(settings=settings, vault=MemoryVault()) as personal:
            response = require(
                personal.http.post(
                    settings.token_url,
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "redirect_uri": settings.redirect_uri,
                        "client_id": settings.client_id,
                        "code_verifier": verifier,
                    },
                ),
                200,
            )
            payload = response.json()
            if approved:
                personal.save(payload["access_token"])
                if personal.access_token() != payload["access_token"]:
                    raise RuntimeError("Synthetic session vault round-trip failed")
            return cast(dict[str, Any], payload)


def main() -> None:
    os.environ["SSL_CERT_FILE"] = str(CERT)
    admin = admin_session()
    created: list[str] = []
    try:
        role = require(admin.get(f"/admin/realms/{REALM}/roles/data_reader"), 200).json()
        operations_role = require(
            admin.get(f"/admin/realms/{REALM}/roles/operations_reader"), 200
        ).json()
        allowed_password = secrets.token_urlsafe(32)
        denied_password = secrets.token_urlsafe(32)
        allowed_id = create_user(admin, f"identity-smoke-{secrets.token_hex(6)}", allowed_password)
        created.append(allowed_id)
        denied_id = create_user(admin, f"identity-smoke-{secrets.token_hex(6)}", denied_password)
        created.append(denied_id)
        require(
            admin.post(
                f"/admin/realms/{REALM}/users/{allowed_id}/role-mappings/realm",
                json=[role],
            ),
            204,
        )
        allowed_name = require(admin.get(f"/admin/realms/{REALM}/users/{allowed_id}"), 200).json()[
            "username"
        ]
        denied_name = require(admin.get(f"/admin/realms/{REALM}/users/{denied_id}"), 200).json()[
            "username"
        ]

        ordinary = user_token(allowed_name, allowed_password, approved=True)
        require(
            admin.post(
                f"/admin/realms/{REALM}/users/{allowed_id}/role-mappings/realm",
                json=[operations_role],
            ),
            204,
        )
        allowed = user_token(allowed_name, allowed_password, approved=True)
        denied = user_token(denied_name, denied_password, approved=False)
        if any("refresh_token" in payload for payload in (ordinary, allowed, denied)):
            raise RuntimeError("Keycloak issued a forbidden refresh token")
        issued = jwt.decode(allowed["access_token"], options={"verify_signature": False})
        if not 86300 <= issued["exp"] - issued["iat"] <= MAX_PERSONAL_SESSION_SECONDS:
            raise RuntimeError("Keycloak did not issue an approximately 24-hour token")
        verifier = TokenVerifier(
            ClientSettings(
                issuer=f"{BASE}/realms/{REALM}",
                audience="retail-api",
                jwks_url=f"{BASE}/realms/{REALM}/protocol/openid-connect/certs",
                client_id="retail-personal",
                authorization_url=f"{BASE}/realms/{REALM}/protocol/openid-connect/auth",
                token_url=f"{BASE}/realms/{REALM}/protocol/openid-connect/token",
                api_url="http://127.0.0.1:8000",
            )
        )
        ordinary_principal = verifier.verify(ordinary["access_token"])
        if "operations:read" in ordinary_principal.scopes:
            raise RuntimeError("Reader without operations role received the audit scope")
        principal = verifier.verify(allowed["access_token"])
        if "operations:read" not in principal.scopes:
            raise RuntimeError("Approved operations user did not receive the audit scope")
        try:
            verifier.verify(denied["access_token"])
        except HTTPException as exc:
            if exc.status_code != 403:
                raise RuntimeError("Denied user failed with unexpected status") from exc
        else:
            raise RuntimeError("Unapproved user received API access")
    finally:
        for user_id in created:
            require(admin.delete(f"/admin/realms/{REALM}/users/{user_id}"), 204)
        admin.close()
    print("Live Keycloak login and API token checks passed; synthetic users removed.")


if __name__ == "__main__":
    main()
