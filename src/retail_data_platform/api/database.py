from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from decimal import Decimal

from sqlalchemy import Connection, Engine, create_engine, text

from retail_data_platform.api.config import Settings
from retail_data_platform.api.resources import RESOURCES


def create_read_engine(settings: Settings) -> Engine:
    return create_engine(
        settings.database_url,
        json_deserializer=lambda value: json.loads(value, parse_float=Decimal),
        pool_size=5,
        max_overflow=0,
        pool_timeout=3,
        pool_pre_ping=True,
        hide_parameters=True,
        connect_args={
            "connect_timeout": 5,
            "options": (
                f"-c search_path={settings.schema},pg_catalog "
                "-c default_transaction_read_only=on -c statement_timeout=5000 "
                "-c lock_timeout=1000 -c idle_in_transaction_session_timeout=10000"
            ),
        },
    )


@contextmanager
def read_connection(engine: Engine) -> Iterator[Connection]:
    with engine.connect() as connection, connection.begin():
        connection.execute(text("SET TRANSACTION READ ONLY"))
        yield connection


def validate_database(engine: Engine, schema: str) -> None:
    """Fail startup if an importer/owner or overprivileged role was supplied."""
    with read_connection(engine) as c:
        unsafe = c.scalar(
            text("""
            SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
                OR r.rolbypassrls OR EXISTS (
                    SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid
                ) OR has_schema_privilege(current_user, :schema, 'CREATE')
            FROM pg_roles r WHERE r.rolname=current_user
        """),
            {"schema": schema},
        )
        if unsafe is not False or c.scalar(text("SELECT current_schema()")) != schema:
            raise RuntimeError("API database role is unsafe")
        for resource in RESOURCES.values():
            relation = f"{schema}.{resource.name}"
            if c.scalar(text("SELECT to_regclass(:relation)"), {"relation": relation}) is None:
                raise RuntimeError("API schema is incomplete")
            writable = c.scalar(
                text("""
                SELECT has_table_privilege(current_user, :relation,
                    'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                    OR has_any_column_privilege(current_user, :relation, 'INSERT,UPDATE')
                    OR EXISTS (SELECT 1 FROM pg_class
                               WHERE oid=to_regclass(:relation)
                               AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user))
            """),
                {"relation": relation},
            )
            if writable:
                raise RuntimeError("API database role is writable")
            for column in resource.table.columns:
                readable = c.scalar(
                    text("SELECT has_column_privilege(current_user, :relation, :column, 'SELECT')"),
                    {"relation": relation, "column": column.name},
                )
                if bool(readable) != (column.name in resource.columns):
                    raise RuntimeError("API column grants do not match the resource contract")


def grant_sql(role: str, schema: str) -> str:
    """Render reviewed grants, never execute administrative SQL from the service."""
    import re

    if not all(re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", item) for item in (role, schema)):
        raise ValueError("Invalid role or schema identifier")
    statements = [f'GRANT USAGE ON SCHEMA "{schema}" TO "{role}";']
    for resource in RESOURCES.values():
        columns = ", ".join(f'"{column}"' for column in resource.columns)
        statements.append(f'GRANT SELECT ({columns}) ON "{schema}"."{resource.name}" TO "{role}";')
    return "\n".join(statements)


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Print explicit API SELECT grants; does not execute SQL"
    )
    parser.add_argument("--role", required=True)
    parser.add_argument("--schema", default="public")
    args = parser.parse_args()
    print(grant_sql(args.role, args.schema))


if __name__ == "__main__":
    main()
