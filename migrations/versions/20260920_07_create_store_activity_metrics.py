"""Create monthly store activity metrics."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260920_07"
down_revision: str | None = "20260917_06"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "store_activity_metrics",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_key", sa.CHAR(length=64), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=True),
        sa.Column("store_match_status", sa.String(length=16), nullable=False),
        sa.Column("store_match_method", sa.String(length=128), nullable=True),
        sa.Column("activity_type", sa.String(length=32), nullable=False),
        sa.Column("activity_count", sa.Integer(), nullable=False),
        sa.Column("source_store_reference", sa.String(length=128), nullable=False),
        sa.Column("source_store_label", sa.String(length=512), nullable=False),
        sa.CheckConstraint(
            "activity_type IN ('calls', 'crowdsourced_visits', 'field_visits')",
            name="ck_store_activity_metrics_type",
        ),
        sa.CheckConstraint(
            "activity_count >= 0",
            name="ck_store_activity_metrics_nonnegative_count",
        ),
        sa.CheckConstraint(
            "store_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_store_activity_metrics_match_status",
        ),
        sa.CheckConstraint(
            "(store_match_status = 'matched') = (store_id IS NOT NULL)",
            name="ck_store_activity_metrics_store_relation",
        ),
        sa.CheckConstraint(
            "(store_match_status = 'unresolved') = (store_match_method IS NULL)",
            name="ck_store_activity_metrics_method_relation",
        ),
        sa.CheckConstraint(
            "date_trunc('month', period)::date = period",
            name="ck_store_activity_metrics_month_period",
        ),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_store_activity_metrics"),
        sa.UniqueConstraint("source_key", name="uq_store_activity_metrics_source_key"),
    )
    op.create_index(
        "ix_store_activity_metrics_period",
        "store_activity_metrics",
        ["period"],
    )
    op.create_index(
        "ix_store_activity_metrics_store_period",
        "store_activity_metrics",
        ["store_id", "period", "activity_type"],
    )
    op.create_index(
        "ix_store_activity_metrics_reconciliation",
        "store_activity_metrics",
        ["store_match_status", "activity_type"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_store_activity_metrics_reconciliation",
        table_name="store_activity_metrics",
    )
    op.drop_index(
        "ix_store_activity_metrics_store_period",
        table_name="store_activity_metrics",
    )
    op.drop_index("ix_store_activity_metrics_period", table_name="store_activity_metrics")
    op.drop_table("store_activity_metrics")
