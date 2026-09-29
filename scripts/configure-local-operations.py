"""Add the optional audit-reader role and scope to an existing local Keycloak realm."""

from __future__ import annotations

from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
REALM = "retail"
ROLE = "operations_reader"
SCOPE = "operations:read"


def require(response: httpx.Response, statuses: tuple[int, ...] = (200,)) -> httpx.Response:
    if response.status_code not in statuses:
        raise RuntimeError(f"Local Keycloak operations setup failed: HTTP {response.status_code}")
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

        realm = require(client.get(f"/admin/realms/{REALM}")).json()
        if realm.get("realm") != REALM:
            raise RuntimeError("Unexpected Keycloak realm")
        role_response = client.get(f"/admin/realms/{REALM}/roles/{ROLE}")
        if role_response.status_code == 404:
            require(
                client.post(
                    f"/admin/realms/{REALM}/roles",
                    json={"name": ROLE, "description": "Read safe API audit projections"},
                ),
                (201,),
            )
        else:
            require(role_response)
        role = require(client.get(f"/admin/realms/{REALM}/roles/{ROLE}")).json()

        scopes = require(client.get(f"/admin/realms/{REALM}/client-scopes")).json()
        matching = [scope for scope in scopes if scope.get("name") == SCOPE]
        if len(matching) > 1:
            raise RuntimeError("Ambiguous local operations scope")
        if not matching:
            require(
                client.post(
                    f"/admin/realms/{REALM}/client-scopes",
                    json={
                        "name": SCOPE,
                        "protocol": "openid-connect",
                        "attributes": {
                            "include.in.token.scope": "true",
                            "display.on.consent.screen": "false",
                        },
                    },
                ),
                (201,),
            )
            scopes = require(client.get(f"/admin/realms/{REALM}/client-scopes")).json()
            matching = [scope for scope in scopes if scope.get("name") == SCOPE]
        scope = matching[0]
        if (
            scope.get("protocol") != "openid-connect"
            or scope.get("attributes", {}).get("include.in.token.scope") != "true"
        ):
            raise RuntimeError("Existing operations scope has unexpected settings")
        scope_path = f"/admin/realms/{REALM}/client-scopes/{scope['id']}"
        mappings = require(client.get(scope_path + "/scope-mappings/realm")).json()
        if any(mapped["id"] != role["id"] for mapped in mappings):
            raise RuntimeError("Operations scope has an unexpected role mapping")
        if role["id"] not in {mapped["id"] for mapped in mappings}:
            require(client.post(scope_path + "/scope-mappings/realm", json=[role]), (204,))

        personal = require(
            client.get(f"/admin/realms/{REALM}/clients", params={"clientId": "retail-personal"})
        ).json()
        if len(personal) != 1 or personal[0].get("clientId") != "retail-personal":
            raise RuntimeError("Expected one personal OIDC client")
        client_path = f"/admin/realms/{REALM}/clients/{personal[0]['id']}"
        defaults = require(client.get(client_path + "/default-client-scopes")).json()
        if scope["id"] in {item["id"] for item in defaults}:
            raise RuntimeError("Operations scope must not be a default client scope")
        optional = require(client.get(client_path + "/optional-client-scopes")).json()
        if scope["id"] not in {item["id"] for item in optional}:
            require(client.put(client_path + f"/optional-client-scopes/{scope['id']}"), (204,))

    print("Optional role-gated operations scope configured; no user role was assigned.")


if __name__ == "__main__":
    main()
