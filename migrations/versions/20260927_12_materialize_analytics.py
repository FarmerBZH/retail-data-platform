"""Materialize analytical results with indexed grains and refresh audit."""

import re
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision: str = "20260927_12"
down_revision: str | None = "20260926_11"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen migration contract, in dependency order. Do not import application code.
GRAINS = {
    "register_product_month": "store_id, period, source_gtin",
    "activity_month": "store_id, period, activity_type",
    "distribution_product_month": "store_id, period, category_code, product_key",
    "shelf_category_month": "store_id, period, category_code",
    "typology_month": "typology_value_id",
    "assortment_candidates": "store_id, period, assortment_id",
    "retailer_assortment_month": "store_id, period, assortment_id",
    "store_category_month": "store_id, period, category_code",
    "monthly_link_quality": "dataset, period, store_match_status",
    "store_month": "store_id, period",
    "store_month_changes": "store_id, period",
}


def definitions() -> dict[str, str]:
    # Reuse the immutable previous revision's exact measure definitions.
    sql = (Path(__file__).parents[1] / "sql" / "20260926_11_store_monthly.sql").read_text()
    statements = {}
    for statement in sql.split(";"):
        match = re.search(r"CREATE VIEW analytics_(\w+) AS\s*(.*)", statement, re.DOTALL)
        if match:
            statements[match[1]] = match[2].strip()
    assert set(statements) == set(GRAINS)
    return statements


def upgrade() -> None:
    for name in reversed(GRAINS):
        op.execute(f"DROP VIEW analytics_{name}")
    for name, definition in definitions().items():
        # The stored query reads already materialized dependencies, avoiding
        # repeated expansion of the same expensive nested views.
        op.execute(f"CREATE MATERIALIZED VIEW analytics_{name} AS {definition} WITH NO DATA")
        op.execute(f"CREATE UNIQUE INDEX uq_am_{name} ON analytics_{name} ({GRAINS[name]})")
        if name == "typology_month":
            op.execute(
                "CREATE INDEX ix_am_typology_store_period_category "
                "ON analytics_typology_month (store_id, period, category_key)"
            )
        if "store_id" in GRAINS[name] or name == "typology_month":
            op.execute(f"CREATE INDEX ix_am_{name}_period ON analytics_{name} (period)")

    op.create_table(
        "analytics_refresh_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source_snapshot_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("source_run_ids", ARRAY(sa.Uuid()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('running', 'succeeded', 'failed')", name="ck_analytics_refresh_status"
        ),
        sa.CheckConstraint(
            "(status = 'running') = (completed_at IS NULL)",
            name="ck_analytics_refresh_completion",
        ),
        sa.CheckConstraint(
            "status <> 'succeeded' OR (source_snapshot_at IS NOT NULL "
            "AND source_run_ids IS NOT NULL AND error_message IS NULL)",
            name="ck_analytics_refresh_success",
        ),
    )
    op.create_index("ix_analytics_refresh_started", "analytics_refresh_runs", ["started_at"])


def downgrade() -> None:
    for name in reversed(GRAINS):
        op.execute(f"DROP MATERIALIZED VIEW analytics_{name}")
    for name, definition in definitions().items():
        op.execute(f"CREATE VIEW analytics_{name} AS {definition}")
    op.drop_table("analytics_refresh_runs")
