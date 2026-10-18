"""Reconcile register revisions and confirmed zero conventions with source evidence."""

import re
from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "20261018_17"
down_revision: str | None = "20261017_16"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRAINS = {
    "register_product_month": "store_id, period, source_gtin",
    "store_month": "store_id, period",
    "store_month_changes": "store_id, period",
    "network_month": "period",
    "network_year": "period",
    "network_overview": "scope",
    "network_month_changes": "period",
}


def definitions(filename: str) -> dict[str, str]:
    sql = (Path(__file__).parents[1] / "sql" / filename).read_text()
    return {
        match[1]: re.sub(r"\s+WITH NO DATA\s*$", "", match[2].strip())
        for statement in sql.split(";")
        if (
            match := re.search(
                r"CREATE (?:MATERIALIZED )?VIEW analytics_(\w+) AS\s*(.*)", statement, re.DOTALL
            )
        )
    }


def replace_views(*, previous: bool) -> None:
    queries = definitions("20260926_11_store_monthly.sql")
    queries.update(definitions("20260930_14_network_analytics.sql"))
    if not previous:
        queries.update(definitions("20261018_17_register_revisions.sql"))
    for name in reversed(GRAINS):
        op.execute(f"DROP MATERIALIZED VIEW analytics_{name}")
    for name, grain in GRAINS.items():
        op.execute(f"CREATE MATERIALIZED VIEW analytics_{name} AS {queries[name]} WITH NO DATA")
        op.execute(f"CREATE UNIQUE INDEX uq_am_{name} ON analytics_{name} ({grain})")
        if "store_id" in grain:
            op.execute(f"CREATE INDEX ix_am_{name}_period ON analytics_{name} (period)")


def upgrade() -> None:
    replace_views(previous=False)


def downgrade() -> None:
    replace_views(previous=True)
