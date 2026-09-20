"""Create monthly numeric distribution observations."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260920_08"
down_revision: str | None = "20260920_07"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "numeric_distribution_observations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_key", sa.CHAR(length=64), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("category_code", sa.String(length=32), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=True),
        sa.Column("store_match_status", sa.String(length=16), nullable=False),
        sa.Column("store_match_method", sa.String(length=128), nullable=True),
        sa.Column("product_id", sa.Uuid(), nullable=True),
        sa.Column("product_match_status", sa.String(length=16), nullable=False),
        sa.Column("product_match_method", sa.String(length=128), nullable=True),
        sa.Column("presence_value", sa.SmallInteger(), nullable=False),
        sa.Column("value_origin", sa.String(length=24), nullable=False),
        sa.Column("source_category_name", sa.String(length=128), nullable=False),
        sa.Column("source_store_reference", sa.String(length=128), nullable=False),
        sa.Column("source_store_label", sa.String(length=512), nullable=False),
        sa.Column("source_product_reference", sa.String(length=128), nullable=False),
        sa.Column("source_product_label", sa.String(length=512), nullable=False),
        sa.CheckConstraint(
            "presence_value IN (0, 1)",
            name="ck_numeric_distribution_observations_binary_value",
        ),
        sa.CheckConstraint(
            "value_origin IN ('reported', 'inferred_absence')",
            name="ck_numeric_distribution_observations_value_origin",
        ),
        sa.CheckConstraint(
            "value_origin != 'inferred_absence' OR presence_value = 0",
            name="ck_numeric_distribution_observations_inferred_value",
        ),
        sa.CheckConstraint(
            "store_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_numeric_distribution_observations_store_status",
        ),
        sa.CheckConstraint(
            "product_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_numeric_distribution_observations_product_status",
        ),
        sa.CheckConstraint(
            "(store_match_status = 'matched') = (store_id IS NOT NULL)",
            name="ck_numeric_distribution_observations_store_relation",
        ),
        sa.CheckConstraint(
            "(product_match_status = 'matched') = (product_id IS NOT NULL)",
            name="ck_numeric_distribution_observations_product_relation",
        ),
        sa.CheckConstraint(
            "(store_match_status = 'unresolved') = (store_match_method IS NULL)",
            name="ck_numeric_distribution_observations_store_method",
        ),
        sa.CheckConstraint(
            "(product_match_status = 'unresolved') = (product_match_method IS NULL)",
            name="ck_numeric_distribution_observations_product_method",
        ),
        sa.CheckConstraint(
            "date_trunc('month', period)::date = period",
            name="ck_numeric_distribution_observations_month_period",
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_numeric_distribution_observations"),
        sa.UniqueConstraint(
            "source_key",
            name="uq_numeric_distribution_observations_source_key",
        ),
    )
    op.create_index(
        "ix_numeric_distribution_observations_period",
        "numeric_distribution_observations",
        ["period"],
    )
    op.create_index(
        "ix_numeric_distribution_observations_category_period",
        "numeric_distribution_observations",
        ["category_code", "period"],
    )
    op.create_index(
        "ix_numeric_distribution_observations_store_product_period",
        "numeric_distribution_observations",
        ["store_id", "product_id", "period"],
    )
    op.create_index(
        "ix_numeric_distribution_observations_reconciliation",
        "numeric_distribution_observations",
        ["store_match_status", "product_match_status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_numeric_distribution_observations_reconciliation",
        table_name="numeric_distribution_observations",
    )
    op.drop_index(
        "ix_numeric_distribution_observations_store_product_period",
        table_name="numeric_distribution_observations",
    )
    op.drop_index(
        "ix_numeric_distribution_observations_category_period",
        table_name="numeric_distribution_observations",
    )
    op.drop_index(
        "ix_numeric_distribution_observations_period",
        table_name="numeric_distribution_observations",
    )
    op.drop_table("numeric_distribution_observations")
