"""Provision the local Keycloak realm and personal OIDC client once.

This deliberately creates no human user and prints no credentials or tokens.
Existing realm configuration is never overwritten.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx

ROOT = Path(__file__).resolve().parent.parent
BASE = "https://localhost:8443"
REALM = "retail"
CLIENT_ID = "retail-personal"


def credentials() -> dict[str, str]:
    return dict(
        line.split("=", 1)
        for line in (ROOT / ".env.identity.local").read_text().splitlines()
        if "=" in line
    )


def request(client: httpx.Client, method: str, path: str, **kwargs: Any) -> httpx.Response:
    response = client.request(method, path, **kwargs)
    if response.status_code not in {200, 201, 204}:
        raise RuntimeError(f"Keycloak {method} {path} failed: HTTP {response.status_code}")
    return response


def main() -> None:
    settings = credentials()
    with httpx.Client(
        base_url=BASE, verify=str(ROOT / ".env.identity.local-certs/tls.crt"), timeout=15
    ) as client:
        token_response = request(
            client,
            "POST",
            "/realms/master/protocol/openid-connect/token",
            data={
                "grant_type": "password",
                "client_id": "admin-cli",
                "username": settings["KC_BOOTSTRAP_ADMIN_USERNAME"],
                "password": settings["KC_BOOTSTRAP_ADMIN_PASSWORD"],
            },
        )
        client.headers["Authorization"] = f"Bearer {token_response.json()['access_token']}"

        existing = client.get(f"/admin/realms/{REALM}")
        if existing.status_code != 404:
            raise RuntimeError("Application realm already exists; refusing to overwrite it")

        request(
            client,
            "POST",
            "/admin/realms",
            json={
                "realm": REALM,
                "enabled": True,
                "sslRequired": "all",
                "registrationAllowed": False,
                "resetPasswordAllowed": False,
                "accessTokenLifespan": 86400,
                "ssoSessionIdleTimeout": 86400,
                "ssoSessionMaxLifespan": 86400,
                "bruteForceProtected": True,
            },
        )

        request(
            client,
            "POST",
            f"/admin/realms/{REALM}/roles",
            json={"name": "data_reader", "description": "Read the global retail API"},
        )
        role = request(client, "GET", f"/admin/realms/{REALM}/roles/data_reader").json()

        request(
            client,
            "POST",
            f"/admin/realms/{REALM}/client-scopes",
            json={
                "name": "data:read",
                "protocol": "openid-connect",
                "attributes": {
                    "include.in.token.scope": "true",
                    "display.on.consent.screen": "false",
                },
            },
        )
        scopes = request(client, "GET", f"/admin/realms/{REALM}/client-scopes").json()
        data_scope = next(scope for scope in scopes if scope["name"] == "data:read")
        request(
            client,
            "POST",
            f"/admin/realms/{REALM}/client-scopes/{data_scope['id']}/scope-mappings/realm",
            json=[role],
        )
        request(
            client,
            "POST",
            f"/admin/realms/{REALM}/roles",
            json={"name": "operations_reader", "description": "Read safe API audit projections"},
        )
        operations_role = request(
            client, "GET", f"/admin/realms/{REALM}/roles/operations_reader"
        ).json()
        request(
            client,
            "POST",
            f"/admin/realms/{REALM}/client-scopes",
            json={
                "name": "operations:read",
                "protocol": "openid-connect",
                "attributes": {
                    "include.in.token.scope": "true",
                    "display.on.consent.screen": "false",
                },
            },
        )
        scopes = request(client, "GET", f"/admin/realms/{REALM}/client-scopes").json()
        operations_scope = next(scope for scope in scopes if scope["name"] == "operations:read")
        request(
            client,
            "POST",
            f"/admin/realms/{REALM}/client-scopes/{operations_scope['id']}/scope-mappings/realm",
            json=[operations_role],
        )

        request(
            client,
            "POST",
            f"/admin/realms/{REALM}/clients",
            json={
                "clientId": CLIENT_ID,
                "name": "Personal read API client",
                "protocol": "openid-connect",
                "enabled": True,
                "publicClient": True,
                "standardFlowEnabled": True,
                "implicitFlowEnabled": False,
                "directAccessGrantsEnabled": False,
                "serviceAccountsEnabled": False,
                "fullScopeAllowed": False,
                "redirectUris": ["http://127.0.0.1:8765/callback"],
                "webOrigins": [],
                "attributes": {
                    "pkce.code.challenge.method": "S256",
                    "use.refresh.tokens": "false",
                    "access.token.header.type.rfc9068": "true",
                    "access.token.signed.response.alg": "RS256",
                    "oauth2.device.authorization.grant.enabled": "false",
                    "oidc.ciba.grant.enabled": "false",
                },
            },
        )
        clients = request(
            client, "GET", f"/admin/realms/{REALM}/clients", params={"clientId": CLIENT_ID}
        ).json()
        personal_id = clients[0]["id"]
        default_scopes = request(
            client, "GET", f"/admin/realms/{REALM}/clients/{personal_id}/default-client-scopes"
        ).json()
        if "basic" not in {scope["name"] for scope in default_scopes}:
            raise RuntimeError("Keycloak did not attach its built-in basic client scope")
        for scope in default_scopes:
            if scope["name"] != "basic":
                request(
                    client,
                    "DELETE",
                    f"/admin/realms/{REALM}/clients/{personal_id}/default-client-scopes/{scope['id']}",
                )
        request(
            client,
            "PUT",
            f"/admin/realms/{REALM}/clients/{personal_id}/optional-client-scopes/{data_scope['id']}",
        )
        request(
            client,
            "PUT",
            f"/admin/realms/{REALM}/clients/{personal_id}/optional-client-scopes/{operations_scope['id']}",
        )
        request(
            client,
            "POST",
            f"/admin/realms/{REALM}/clients/{personal_id}/protocol-mappers/models",
            json={
                "name": "retail-api-audience",
                "protocol": "openid-connect",
                "protocolMapper": "oidc-audience-mapper",
                "config": {
                    "included.custom.audience": "retail-api",
                    "access.token.claim": "true",
                    "id.token.claim": "false",
                },
            },
        )

        basic = next(scope for scope in scopes if scope["name"] == "basic")
        basic_mappers = request(
            client,
            "GET",
            f"/admin/realms/{REALM}/client-scopes/{basic['id']}/protocol-mappers/models",
        ).json()
        auth_time_mapped = any(
            mapper.get("config", {}).get("claim.name") == "auth_time"
            and mapper.get("config", {}).get("access.token.claim") == "true"
            for mapper in basic_mappers
        )
        if not auth_time_mapped:
            raise RuntimeError("Keycloak basic scope lacks access-token auth_time mapping")

    print("Local realm, role-gated read scopes, public client and audience configured.")
    print("No personal user was created; create one in the Keycloak admin console.")


if __name__ == "__main__":
    main()
