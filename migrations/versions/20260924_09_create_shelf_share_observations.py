"""Create monthly shelf share observations."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260924_09"
down_revision: str | None = "20260920_08"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shelf_share_observations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_key", sa.CHAR(length=64), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("category_code", sa.String(length=32), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=True),
        sa.Column("store_match_status", sa.String(length=16), nullable=False),
        sa.Column("store_match_method", sa.String(length=128), nullable=True),
        sa.Column("company_value", sa.Numeric(18, 2), nullable=False),
        sa.Column("total_value", sa.Numeric(18, 2), nullable=False),
        sa.Column("share", sa.Numeric(12, 8), nullable=True),
        sa.Column("source_row_count", sa.Integer(), nullable=False),
        sa.Column("source_category_name", sa.String(length=128), nullable=False),
        sa.Column("source_store_reference", sa.String(length=128), nullable=False),
        sa.Column("source_store_label", sa.String(length=512), nullable=False),
        sa.CheckConstraint(
            "store_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_shelf_share_observations_store_status",
        ),
        sa.CheckConstraint(
            "(store_match_status = 'matched') = (store_id IS NOT NULL)",
            name="ck_shelf_share_observations_store_relation",
        ),
        sa.CheckConstraint(
            "(store_match_status = 'unresolved') = (store_match_method IS NULL)",
            name="ck_shelf_share_observations_method_relation",
        ),
        sa.CheckConstraint(
            "company_value >= 0 AND total_value >= 0",
            name="ck_shelf_share_observations_nonnegative_values",
        ),
        sa.CheckConstraint(
            "(total_value = 0) = (share IS NULL)",
            name="ck_shelf_share_observations_share_relation",
        ),
        sa.CheckConstraint(
            "source_row_count > 0",
            name="ck_shelf_share_observations_source_row_count",
        ),
        sa.CheckConstraint(
            "date_trunc('month', period)::date = period",
            name="ck_shelf_share_observations_month_period",
        ),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_shelf_share_observations"),
        sa.UniqueConstraint("source_key", name="uq_shelf_share_observations_source_key"),
    )
    op.create_index(
        "ix_shelf_share_observations_period_category",
        "shelf_share_observations",
        ["period", "category_code"],
    )
    op.create_index(
        "ix_shelf_share_observations_store_period",
        "shelf_share_observations",
        ["store_id", "period"],
    )
    op.create_index(
        "ix_shelf_share_observations_reconciliation",
        "shelf_share_observations",
        ["store_match_status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_shelf_share_observations_reconciliation", table_name="shelf_share_observations"
    )
    op.drop_index("ix_shelf_share_observations_store_period", table_name="shelf_share_observations")
    op.drop_index(
        "ix_shelf_share_observations_period_category", table_name="shelf_share_observations"
    )
    op.drop_table("shelf_share_observations")
