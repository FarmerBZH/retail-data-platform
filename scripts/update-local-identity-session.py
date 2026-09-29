"""Idempotently move an existing local Keycloak realm from 30 minutes to 24 hours."""

from __future__ import annotations

from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
REALM_URL = "/admin/realms/retail"
LIFESPAN_FIELDS = (
    "accessTokenLifespan",
    "ssoSessionIdleTimeout",
    "ssoSessionMaxLifespan",
)


def require(response: httpx.Response) -> httpx.Response:
    if response.status_code not in {200, 204}:
        raise RuntimeError(f"Local Keycloak update failed: HTTP {response.status_code}")
    return response


def main() -> None:
    values = dict(
        line.split("=", 1)
        for line in (ROOT / ".env.identity.local").read_text().splitlines()
        if "=" in line
    )
    with httpx.Client(
        base_url="https://localhost:8443",
        verify=str(ROOT / ".env.identity.local-certs/tls.crt"),
        timeout=15,
    ) as client:
        token = require(
            client.post(
                "/realms/master/protocol/openid-connect/token",
                data={
                    "grant_type": "password",
                    "client_id": "admin-cli",
                    "username": values["KC_BOOTSTRAP_ADMIN_USERNAME"],
                    "password": values["KC_BOOTSTRAP_ADMIN_PASSWORD"],
                },
            )
        ).json()["access_token"]
        client.headers["Authorization"] = f"Bearer {token}"
        realm = require(client.get(REALM_URL)).json()
        if realm.get("realm") != "retail":
            raise RuntimeError("Unexpected Keycloak realm")
        if any(realm.get(field) not in {1800, 86400} for field in LIFESPAN_FIELDS):
            raise RuntimeError("Unexpected existing session policy; review it manually")
        if all(realm[field] == 86400 for field in LIFESPAN_FIELDS):
            print("Local Keycloak session policy is already 24 hours.")
            return
        require(client.put(REALM_URL, json={field: 86400 for field in LIFESPAN_FIELDS}))
        updated = require(client.get(REALM_URL)).json()
        if any(updated.get(field) != 86400 for field in LIFESPAN_FIELDS):
            raise RuntimeError("Keycloak did not retain the 24-hour session policy")
    print("Local Keycloak access token and SSO session policy set to 24 hours.")


if __name__ == "__main__":
    main()
