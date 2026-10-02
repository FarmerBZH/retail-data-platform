"""Opt-in browser/API smoke against local Keycloak and disposable PostgreSQL state."""

from __future__ import annotations

import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import logging
import os
import secrets
import signal
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from types import ModuleType
from typing import Any

import httpx
from alembic import command
from alembic.config import Config
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from sqlalchemy import create_engine, insert, text
from sqlalchemy.engine import make_url

from retail_data_platform.api.database import grant_sql
from retail_data_platform.database.models import Store

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = "http://127.0.0.1:4181"
API = "http://127.0.0.1:8181"
BASE = "https://localhost:8443"


def load(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / f"{name}.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Local smoke helper unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def free_port(port: int) -> None:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", port))


def wait_ready(url: str, process: subprocess.Popen[bytes]) -> None:
    with httpx.Client(timeout=1) as client:
        for _ in range(60):
            if process.poll() is not None:
                raise RuntimeError("Smoke service failed to start")
            try:
                if client.get(url).status_code in {200, 401}:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.5)
    raise RuntimeError("Smoke service startup deadline exceeded")


def stop(process: subprocess.Popen[bytes]) -> None:
    # The session leader may have exited while its descendants are still running.
    with contextlib.suppress(ProcessLookupError):
        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=10)
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)


def stop_all(processes: list[subprocess.Popen[bytes]]) -> None:
    # ExitStack still executes the remaining callbacks when one stop fails.
    with contextlib.ExitStack() as cleanup:
        for process in processes:
            cleanup.callback(stop, process)


def main() -> None:
    # No environment file is loaded into the app: these local prerequisites are explicit.
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        raise RuntimeError("TEST_DATABASE_URL is required for the disposable test schema")
    parsed = make_url(url)
    if parsed.drivername != "postgresql+psycopg" or parsed.host not in {"localhost", "127.0.0.1"}:
        raise RuntimeError("Smoke requires local PostgreSQL")
    free_port(4181)
    free_port(8181)
    provision = load("configure-local-identity")
    identity = load("smoke-local-identity")
    suffix = secrets.token_hex(8)
    realm = f"browser-smoke-{suffix}"
    schema, role = f"browser_test_{suffix}", f"browser_reader_{suffix}"
    provision.__dict__["REALM"] = realm
    identity.__dict__["REALM"] = realm
    cert = ROOT / ".env.identity.local-certs/tls.crt"
    os.environ["SSL_CERT_FILE"] = str(cert)
    certificate = x509.load_pem_x509_certificate(cert.read_bytes())
    public = certificate.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    pin = base64.b64encode(hashlib.sha256(public).digest()).decode()
    admin: httpx.Client = identity.admin_session()
    engine = create_engine(
        url,
        hide_parameters=True,
        connect_args={"options": f"-c search_path={schema},pg_catalog"},
    )
    processes: list[subprocess.Popen[bytes]] = []
    realm_created = schema_created = role_created = False
    try:
        # All mutations target newly generated disposable identifiers, never the existing realm.
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                provision.main()
            finally:
                realm_created = admin.get(f"/admin/realms/{realm}").status_code == 200
        clients = identity.require(
            admin.get(f"/admin/realms/{realm}/clients", params={"clientId": "retail-personal"}), 200
        ).json()
        client = clients[0]
        client["redirectUris"] = ["http://127.0.0.1:8765/callback", f"{ORIGIN}/oidc/callback"]
        client["webOrigins"] = [ORIGIN]
        identity.require(
            admin.put(f"/admin/realms/{realm}/clients/{client['id']}", json=client), 204
        )
        data_role = identity.require(
            admin.get(f"/admin/realms/{realm}/roles/data_reader"), 200
        ).json()
        users: dict[str, dict[str, str]] = {}
        for kind in ("allowed", "denied"):
            username, password = f"synthetic-{kind}", secrets.token_urlsafe(32)
            user_id = identity.create_user(admin, username, password)
            if kind == "allowed":
                identity.require(
                    admin.post(
                        f"/admin/realms/{realm}/users/{user_id}/role-mappings/realm",
                        json=[data_role],
                    ),
                    204,
                )
            users[kind] = {"username": username, "password": password}

        password = secrets.token_hex(32)
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
            schema_created = True
            config = Config(str(ROOT / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            command.check(config)
            connection.exec_driver_sql(f"CREATE ROLE {role} LOGIN PASSWORD '{password}'")
            role_created = True
            for statement in grant_sql(role, schema).split(";"):
                if statement.strip():
                    connection.exec_driver_sql(statement)
            connection.execute(
                insert(Store),
                [
                    {
                        "id": uuid.UUID(int=index),
                        "source_key": f"synthetic-{index}",
                        "name": f"Synthetic store {index}",
                    }
                    for index in (1, 2)
                ],
            )
        reader_url = parsed.set(username=role, password=password).render_as_string(
            hide_password=False
        )
        issuer = f"{BASE}/realms/{realm}"
        env = {
            **os.environ,
            "API_DATABASE_URL": reader_url,
            "API_SCHEMA": schema,
            "API_ISSUER": issuer,
            "API_AUDIENCE": "retail-api",
            "API_JWKS_URL": f"{issuer}/protocol/openid-connect/certs",
            "API_CLIENT_ID": "retail-personal",
            "API_ORIGINS": ORIGIN,
        }
        api = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "retail_data_platform.api.app:create_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                "8181",
                "--no-access-log",
                "--log-level",
                "critical",
            ],
            cwd=ROOT,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        processes.append(api)
        wait_ready(f"{API}/v1/resources", api)
        # Keep DB/admin secrets out of the Vite and browser subprocess environments.
        frontend_env = {
            key: os.environ[key]
            for key in ("PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT", "LANG", "LC_ALL")
            if key in os.environ
        }
        frontend_env.update(
            {
                "VITE_API_BASE_URL": API,
                "VITE_OIDC_ISSUER": issuer,
                "VITE_OIDC_CLIENT_ID": "retail-personal",
                "VITE_OIDC_REDIRECT_URI": f"{ORIGIN}/oidc/callback",
            }
        )
        frontend = subprocess.Popen(
            ["npm", "run", "dev", "--", "--mode", "e2e", "--port", "4181"],
            cwd=ROOT / "frontend",
            env=frontend_env,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        processes.append(frontend)
        wait_ready(ORIGIN, frontend)
        payload: dict[str, Any] = {
            "issuer": issuer,
            "origin": ORIGIN,
            "api": API,
            "pin": pin,
            **users,
        }
        browser = subprocess.Popen(
            ["node", "test/live-smoke.ts"],
            cwd=ROOT / "frontend",
            env=frontend_env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        processes.append(browser)
        _, browser_errors = browser.communicate(json.dumps(payload).encode(), timeout=180)
        if browser.returncode:
            for label in (
                "prepare",
                "frontend",
                "provider",
                "callback",
                "allowed-session",
                "denied-session",
                "read",
                "redirect-refusal",
                "scope-refusal",
                "origin-refusal",
            ):
                if f"LIVE_STAGE:{label}\n".encode() in browser_errors:
                    print(f"Failed browser check: {label}")
            raise RuntimeError("Browser smoke failed; sensitive diagnostics suppressed")
        print("Live browser/API allow, scope/CORS/callback denial, pagination and logout passed.")
        # Exercise the original CLI PKCE request, validator and memory vault in the same realm.
        cli = identity.user_token(**users["allowed"], approved=True)
        with httpx.Client(timeout=10) as http:
            response = http.get(
                f"{API}/v1/data/stores?limit=1",
                headers={"Authorization": f"Bearer {cli['access_token']}"},
            )
            if response.status_code != 200:
                raise RuntimeError("CLI token API read failed")
        print("CLI personal-token validation, memory-vault round-trip and API read passed.")
        wrong = {**client, "clientId": "synthetic-wrong-client"}
        wrong.pop("id")
        wrong["protocolMappers"] = [
            {key: value for key, value in mapper.items() if key != "id"}
            for mapper in client.get("protocolMappers", [])
        ]
        identity.require(admin.post(f"/admin/realms/{realm}/clients", json=wrong), 201)
        denied_token = identity.user_token(
            **users["allowed"], approved=False, client_id="synthetic-wrong-client"
        )

        def refused(token: str) -> None:
            with httpx.Client(timeout=10) as http:
                response = http.get(
                    f"{API}/v1/resources", headers={"Authorization": f"Bearer {token}"}
                )
                if response.status_code != 401:
                    raise RuntimeError("Invalid identity token was not refused")

        refused(denied_token["access_token"])
        mappers = identity.require(
            admin.get(f"/admin/realms/{realm}/clients/{client['id']}/protocol-mappers/models"), 200
        ).json()
        audience = next(
            mapper for mapper in mappers if mapper["protocolMapper"] == "oidc-audience-mapper"
        )
        audience["config"]["included.custom.audience"] = "synthetic-wrong-audience"
        identity.require(
            admin.put(
                f"/admin/realms/{realm}/clients/{client['id']}/protocol-mappers/models/{audience['id']}",
                json=audience,
            ),
            204,
        )
        refused(identity.user_token(**users["allowed"], approved=False)["access_token"])
        audience["config"]["included.custom.audience"] = "retail-api"
        identity.require(
            admin.put(
                f"/admin/realms/{realm}/clients/{client['id']}/protocol-mappers/models/{audience['id']}",
                json=audience,
            ),
            204,
        )
        client["attributes"]["access.token.lifespan"] = "1"
        identity.require(
            admin.put(f"/admin/realms/{realm}/clients/{client['id']}", json=client), 204
        )
        expired = identity.user_token(**users["allowed"], approved=False)["access_token"]
        time.sleep(2)
        refused(expired)
        print("Real signed wrong-client, wrong-audience and expired-token API refusal passed.")
    finally:
        try:
            stop_all(processes)
        finally:
            try:
                if realm_created:
                    identity.require(admin.delete(f"/admin/realms/{realm}"), 204)
            finally:
                admin.close()
                try:
                    with engine.begin() as connection:
                        if schema_created:
                            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
                        if role_created:
                            connection.execute(text(f'DROP ROLE IF EXISTS "{role}"'))
                finally:
                    engine.dispose()
    print("Disposable identity realm, users, schema and read role removed.")


if __name__ == "__main__":
    logging.disable(logging.CRITICAL)
    try:
        main()
    except Exception:
        print(
            "Local browser smoke failed; credentials and response diagnostics suppressed.",
            file=sys.stderr,
        )
        sys.exit(1)
