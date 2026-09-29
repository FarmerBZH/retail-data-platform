from __future__ import annotations

import base64
import hashlib
import secrets
import time
import webbrowser
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx

from retail_data_platform.personal_auth.client import PersonalClient
from retail_data_platform.personal_auth.config import ClientSettings


def authorization_request(settings: ClientSettings) -> tuple[str, str, str]:
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    params = {
        "response_type": "code",
        "client_id": settings.client_id,
        "redirect_uri": settings.redirect_uri,
        "scope": "openid data:read operations:read",
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "login",
        "max_age": "0",
    }
    return settings.authorization_url + "?" + urlencode(params), state, verifier


def callback_code(path: str, state: str, issuer: str) -> str | None:
    parsed = urlsplit(path)
    if len(path) > 8192 or parsed.path != "/callback" or parsed.scheme or parsed.netloc:
        raise ValueError("Invalid callback")
    values = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=12)
    if any(len(v) != 1 for v in values.values()):
        raise ValueError("Invalid callback")
    supplied_state = values.get("state", [""])[0]
    if not supplied_state.isascii() or not secrets.compare_digest(supplied_state, state):
        raise ValueError("Invalid callback")
    if values.get("iss") != [issuer]:
        raise ValueError("Invalid callback issuer")
    if "error" in values:
        return None
    code = values.get("code", [""])[0]
    if not code or len(code) > 4096:
        raise ValueError("Missing authorization code")
    return code


def exchange_code(client: PersonalClient, code: str, verifier: str) -> None:
    try:
        response = client.http.post(
            client.settings.token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": client.settings.redirect_uri,
                "client_id": client.settings.client_id,
                "code_verifier": verifier,
            },
        )
        if response.status_code != 200 or len(response.content) > 65_536:
            raise ValueError()
        payload = response.json()
        if (
            not isinstance(payload, dict)
            or payload.get("token_type", "").lower() != "bearer"
            or "refresh_token" in payload
            or not isinstance(payload.get("access_token"), str)
        ):
            raise ValueError()
    except (httpx.HTTPError, ValueError, TypeError, AttributeError):
        raise RuntimeError(
            "Login exchange rejected; check provider settings (no refresh tokens)"
        ) from None
    client.save(payload["access_token"])


def login(
    client: PersonalClient,
    *,
    open_browser: Callable[[str], bool] = webbrowser.open,
    announce: Callable[[str], None] = print,
    timeout: float = 180,
) -> None:
    # Starting a new login discards the previous local session, even on cancellation.
    client.logout()
    settings = client.settings
    url, state, verifier = authorization_request(settings)
    outcome: list[str | None] = []

    class Callback(BaseHTTPRequestHandler):
        def setup(self) -> None:
            self.request.settimeout(2)
            super().setup()

        def log_message(self, format: str, *args: object) -> None:
            pass  # Never log callback URLs or authorization codes.

        def do_GET(self) -> None:
            try:
                if self.headers.get("Host") != f"127.0.0.1:{settings.callback_port}":
                    raise ValueError()
                code = callback_code(self.path, state, settings.issuer)
            except ValueError:
                self.send_error(400, "Invalid callback")
                return
            outcome.append(code)
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
            )
            self.end_headers()
            self.wfile.write(
                b"Return to the terminal to check whether login succeeded. You can close this tab."
            )

    with HTTPServer(("127.0.0.1", settings.callback_port), Callback) as server:
        server.timeout = 0.5
        announce(
            "Complete the personal login in your browser. This login expires after three minutes."
        )
        if not open_browser(url):
            announce("Open this authorization URL in your browser: " + url)
        deadline = time.monotonic() + timeout
        while not outcome and time.monotonic() < deadline:
            server.handle_request()
    if not outcome or outcome[0] is None:
        raise RuntimeError("Login cancelled or timed out; run retail-auth login again")
    exchange_code(client, outcome[0], verifier)
