from __future__ import annotations

import os

from sqlalchemy import Engine, create_engine


def database_url_from_env() -> str:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        raise RuntimeError("DATABASE_URL must be set")
    return database_url


def create_database_engine(database_url: str | None = None) -> Engine:
    return create_engine(database_url or database_url_from_env(), pool_pre_ping=True)
