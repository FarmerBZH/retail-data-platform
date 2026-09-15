from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool

import retail_data_platform.database.models  # noqa: F401
from retail_data_platform.database.base import Base
from retail_data_platform.database.session import database_url_from_env

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=database_url_from_env(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(database_url_from_env(), poolclass=NullPool)

    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
