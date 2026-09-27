"""Create conservative monthly store analytical views."""

from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "20260926_11"
down_revision: str | None = "20260925_10"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    sql = Path(__file__).parents[1] / "sql" / "20260926_11_store_monthly.sql"
    # Separate statements also work with psycopg's extended query protocol.
    for statement in sql.read_text().split(";"):
        if statement.strip():
            op.execute(statement)


def downgrade() -> None:
    for name in (
        "analytics_store_month_changes",
        "analytics_store_month",
        "analytics_monthly_link_quality",
        "analytics_store_category_month",
        "analytics_retailer_assortment_month",
        "analytics_assortment_candidates",
        "analytics_typology_month",
        "analytics_shelf_category_month",
        "analytics_distribution_product_month",
        "analytics_activity_month",
        "analytics_register_product_month",
    ):
        op.execute(f"DROP VIEW {name}")
