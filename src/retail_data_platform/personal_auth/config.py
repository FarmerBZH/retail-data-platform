from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass
from urllib.parse import urlsplit

from retail_data_platform.api.config import https_url


@dataclass(frozen=True)
class ClientSettings:
    issuer: str
    audience: str
    jwks_url: str
    client_id: str
    authorization_url: str
    token_url: str
    api_url: str
    callback_port: int = 8765

    def __post_init__(self) -> None:
        if not all(
            https_url(value)
            for value in (self.issuer, self.jwks_url, self.authorization_url, self.token_url)
        ):
            raise ValueError("Identity endpoints require HTTPS")
        if not self.audience or not self.client_id or not 1024 <= self.callback_port <= 65535:
            raise ValueError("Invalid personal authentication configuration")
        parsed = urlsplit(self.api_url)
        local = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}
        if (
            not (https_url(self.api_url) or local)
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise ValueError("API requires HTTPS or loopback HTTP")

    @property
    def vault_account(self) -> str:
        context = "\n".join((self.issuer, self.audience, self.client_id, self.api_url))
        return hashlib.sha256(context.encode()).hexdigest()

    @property
    def redirect_uri(self) -> str:
        return f"http://127.0.0.1:{self.callback_port}/callback"

    @classmethod
    def from_env(cls) -> ClientSettings:
        try:
            return cls(
                issuer=os.environ["API_ISSUER"],
                audience=os.environ["API_AUDIENCE"],
                jwks_url=os.environ["API_JWKS_URL"],
                client_id=os.getenv("API_CLIENT_ID", "retail-personal"),
                authorization_url=os.environ["AUTH_AUTHORIZATION_URL"],
                token_url=os.environ["AUTH_TOKEN_URL"],
                api_url=os.getenv("AUTH_API_URL", "http://127.0.0.1:8000"),
                callback_port=int(os.getenv("AUTH_CALLBACK_PORT", "8765")),
            )
        except (KeyError, ValueError):
            raise ValueError("Missing or invalid personal authentication configuration") from None
