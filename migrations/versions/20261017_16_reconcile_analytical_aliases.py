"""Reconcile reported presence and explicit historical label mappings."""

import re
from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "20261017_16"
down_revision: str | None = "20261015_15"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen dependency closure. Unchanged source-grain and internal views survive.
GRAINS = {
    "distribution_product_month": "store_id, period, category_code, product_key",
    "typology_month": "typology_value_id",
    "assortment_candidates": "store_id, period, assortment_id",
    "retailer_assortment_month": "store_id, period, assortment_id",
    "store_category_month": "store_id, period, category_code",
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
    queries.update(definitions("20261017_16_retailer_previous.sql"))
    if not previous:
        queries.update(definitions("20261017_16_reconcile_analytics.sql"))
    for name in reversed(GRAINS):
        op.execute(f"DROP MATERIALIZED VIEW analytics_{name}")
    for name, grain in GRAINS.items():
        op.execute(f"CREATE MATERIALIZED VIEW analytics_{name} AS {queries[name]} WITH NO DATA")
        op.execute(f"CREATE UNIQUE INDEX uq_am_{name} ON analytics_{name} ({grain})")
        if name == "typology_month":
            op.execute(
                "CREATE INDEX ix_am_typology_store_period_category "
                "ON analytics_typology_month (store_id, period, category_key)"
            )
        if "store_id" in grain or name == "typology_month":
            op.execute(f"CREATE INDEX ix_am_{name}_period ON analytics_{name} (period)")


def upgrade() -> None:
    replace_views(previous=False)


def downgrade() -> None:
    replace_views(previous=True)
