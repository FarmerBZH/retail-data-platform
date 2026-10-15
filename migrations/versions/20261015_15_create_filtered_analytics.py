"""Freeze analytical store dimensions and observed dataset availability."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "20261015_15"
down_revision: str | None = "20260930_14"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRAINS = {
    "store_scope": "store_id",
    "store_dataset_month": "store_id, period, dataset",
}


def upgrade() -> None:
    sql = (Path(__file__).parents[1] / "sql" / "20261015_15_filtered_analytics.sql").read_text()
    for statement in sql.split(";"):
        if statement.strip():
            op.execute(statement)
    for name, grain in GRAINS.items():
        op.execute(f"CREATE UNIQUE INDEX uq_am_{name} ON analytics_{name} ({grain})")


def downgrade() -> None:
    for name in reversed(GRAINS):
        op.execute(f"DROP MATERIALIZED VIEW analytics_{name}")
