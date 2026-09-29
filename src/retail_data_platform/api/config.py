from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


def https_url(value: str) -> bool:
    parsed = urlsplit(value)
    return bool(
        parsed.scheme == "https"
        and parsed.hostname
        and not parsed.username
        and not parsed.password
        and not parsed.fragment
        and not parsed.query
    )


@dataclass(frozen=True)
class Settings:
    database_url: str = field(repr=False)
    issuer: str
    audience: str
    jwks_url: str
    hosts: tuple[str, ...] = ("localhost", "127.0.0.1")
    origins: tuple[str, ...] = ()
    schema: str = "public"
    response_bytes: int = 2_000_000
    client_id: str = "retail-personal"

    def __post_init__(self) -> None:
        url = make_url(self.database_url)
        if url.drivername != "postgresql+psycopg":
            raise ValueError("API requires PostgreSQL psycopg")
        if url.host not in {"localhost", "127.0.0.1", "::1"} and (
            url.query.get("sslmode") != "verify-full"
        ):
            raise ValueError("Remote PostgreSQL requires sslmode=verify-full")
        if not https_url(self.issuer) or not https_url(self.jwks_url) or not self.audience:
            raise ValueError("HTTPS identity URLs and an API audience are required")
        if not self.client_id:
            raise ValueError("A personal public client ID is required")
        if not self.hosts or any("*" in host or "/" in host for host in self.hosts):
            raise ValueError("Exact trusted hosts are required")
        if not re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", self.schema):
            raise ValueError("Invalid application schema")
        for origin in self.origins:
            parsed = urlsplit(origin)
            if (
                not parsed.hostname
                or parsed.path
                or parsed.query
                or parsed.fragment
                or parsed.username
                or parsed.password
                or "*" in origin
                or (
                    parsed.scheme != "https"
                    and not (
                        parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
                    )
                )
            ):
                raise ValueError("Exact HTTPS origins are required (loopback HTTP is allowed)")
        if not 1024 <= self.response_bytes <= 10_000_000:
            raise ValueError("Invalid response size limit")

    @classmethod
    def from_env(cls) -> Settings:
        try:
            return cls(
                database_url=os.environ["API_DATABASE_URL"],
                issuer=os.environ["API_ISSUER"],
                audience=os.environ["API_AUDIENCE"],
                jwks_url=os.environ["API_JWKS_URL"],
                hosts=tuple(os.getenv("API_HOSTS", "localhost,127.0.0.1").split(",")),
                origins=tuple(filter(None, os.getenv("API_ORIGINS", "").split(","))),
                schema=os.getenv("API_SCHEMA", "public"),
                client_id=os.getenv("API_CLIENT_ID", "retail-personal"),
            )
        except (KeyError, ValueError, ArgumentError):
            raise RuntimeError("Invalid or missing API configuration") from None
