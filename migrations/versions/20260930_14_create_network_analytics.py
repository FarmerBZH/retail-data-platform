"""Publish network summaries with explicit measure coverage."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "20260930_14"
down_revision: str | None = "20260927_13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRAINS = {
    "network_month": "period",
    "network_year": "period",
    "network_overview": "scope",
    "network_month_changes": "period",
}


def upgrade() -> None:
    sql = (Path(__file__).parents[1] / "sql" / "20260930_14_network_analytics.sql").read_text()
    for statement in sql.split(";"):
        if statement.strip():
            op.execute(statement)
    for name, grain in GRAINS.items():
        op.execute(f"CREATE UNIQUE INDEX uq_am_{name} ON analytics_{name} ({grain})")


def downgrade() -> None:
    for name in reversed(GRAINS):
        op.execute(f"DROP MATERIALIZED VIEW analytics_{name}")
