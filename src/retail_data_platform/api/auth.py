from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Protocol

import jwt
from fastapi import HTTPException

MAX_PERSONAL_SESSION_SECONDS = 24 * 60 * 60


class IdentitySettings(Protocol):
    @property
    def issuer(self) -> str: ...
    @property
    def audience(self) -> str: ...
    @property
    def jwks_url(self) -> str: ...
    @property
    def client_id(self) -> str: ...


@dataclass(frozen=True)
class Principal:
    subject: str
    scopes: frozenset[str]


class TokenVerifier:
    """Fixed issuer and algorithm; cached JWKS with throttled unknown-key refresh."""

    def __init__(self, settings: IdentitySettings) -> None:
        self.settings = settings
        self.client = jwt.PyJWKClient(settings.jwks_url, lifespan=300, timeout=3)
        self.lock = threading.Lock()
        self.last_refresh = 0.0

    def signing_key(self, kid: str) -> Any:
        # A random kid must not cause one outbound fetch per unauthenticated request.
        with self.lock:
            keys = self.client.get_signing_keys()
            found = next((key for key in keys if key.key_id == kid), None)
            if found is None and time.monotonic() - self.last_refresh >= 30:
                self.last_refresh = time.monotonic()
                keys = self.client.get_signing_keys(refresh=True)
                found = next((key for key in keys if key.key_id == kid), None)
            if found is None or found.algorithm_name != "RS256":
                raise jwt.InvalidTokenError()
            return found.key

    def verify(self, token: str) -> Principal:
        try:
            if len(token) > 8192:
                raise jwt.InvalidTokenError()
            header = jwt.get_unverified_header(token)
            if (
                header.get("alg") != "RS256"
                or header.get("typ") != "at+jwt"
                or not isinstance(header.get("kid"), str)
                or not header["kid"]
                or header.get("crit")
            ):
                raise jwt.InvalidTokenError()
            claims = jwt.decode(
                token,
                self.signing_key(header["kid"]),
                algorithms=["RS256"],
                issuer=self.settings.issuer,
                audience=self.settings.audience,
                options={
                    "require": ["exp", "iat", "iss", "aud", "sub", "auth_time", "azp"],
                    "strict_aud": True,
                },
            )
            if (
                type(claims["exp"]) is not int
                or type(claims["iat"]) is not int
                or not 0 < claims["exp"] - claims["iat"] <= MAX_PERSONAL_SESSION_SECONDS
                or type(claims["auth_time"]) is not int
                or not 0 <= claims["iat"] - claims["auth_time"] <= 60
                or not claims["auth_time"]
                <= time.time()
                < claims["auth_time"] + MAX_PERSONAL_SESSION_SECONDS
                or claims["azp"] != self.settings.client_id
                or not isinstance(claims["sub"], str)
                or not claims["sub"]
                or not isinstance(claims.get("scope"), str)
            ):
                raise jwt.InvalidTokenError()
            principal = Principal(claims["sub"], frozenset(claims["scope"].split()))
        except jwt.PyJWKClientConnectionError:
            raise HTTPException(503, "identity_unavailable") from None
        except (jwt.PyJWTError, ValueError, TypeError, KeyError):
            raise HTTPException(
                401, "invalid_token", headers={"WWW-Authenticate": "Bearer"}
            ) from None
        if "data:read" not in principal.scopes:
            raise HTTPException(403, "insufficient_scope")
        return principal
