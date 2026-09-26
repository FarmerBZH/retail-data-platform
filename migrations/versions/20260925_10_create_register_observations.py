"""Create source-grain register observations."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260925_10"
down_revision: str | None = "20260924_09"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "register_observations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("source_kind", sa.String(16), nullable=False),
        sa.Column("source_store_reference", sa.String(64), nullable=False),
        sa.Column("source_store_secondary_reference", sa.String(64), nullable=True),
        sa.Column("source_store_label", sa.String(255), nullable=True),
        sa.Column("store_id", sa.Uuid(), nullable=True),
        sa.Column("store_match_status", sa.String(16), nullable=False),
        sa.Column("store_match_method", sa.String(64), nullable=True),
        sa.Column("source_gtin", sa.String(14), nullable=False),
        sa.Column("source_product_label", sa.String(255), nullable=True),
        sa.Column("source_brand", sa.String(128), nullable=True),
        sa.Column("source_family", sa.String(128), nullable=True),
        sa.Column("product_id", sa.Uuid(), nullable=True),
        sa.Column("product_match_status", sa.String(16), nullable=False),
        sa.Column("revenue_value", sa.Numeric(20, 2), nullable=True),
        sa.Column("revenue_change_ratio", sa.Numeric(20, 8), nullable=True),
        sa.Column("units_sold", sa.BigInteger(), nullable=True),
        sa.Column("units_change_ratio", sa.Numeric(20, 8), nullable=True),
        sa.Column("average_unit_price", sa.Numeric(20, 6), nullable=True),
        sa.Column("average_price_change_ratio", sa.Numeric(20, 8), nullable=True),
        sa.Column("volume_value", sa.Numeric(20, 6), nullable=True),
        sa.Column("volume_change_ratio", sa.Numeric(20, 8), nullable=True),
        sa.CheckConstraint(
            "source_kind IN ('monthly', 'supplement')",
            name="ck_register_observations_source_kind",
        ),
        sa.CheckConstraint(
            "store_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_register_observations_store_match_status",
        ),
        sa.CheckConstraint(
            "(store_match_status = 'matched') = (store_id IS NOT NULL)",
            name="ck_register_observations_store_relation",
        ),
        sa.CheckConstraint(
            "(store_match_status = 'unresolved') = (store_match_method IS NULL)",
            name="ck_register_observations_store_method_relation",
        ),
        sa.CheckConstraint(
            "product_match_status IN ('matched', 'unresolved')",
            name="ck_register_observations_product_match_status",
        ),
        sa.CheckConstraint(
            "(product_match_status = 'matched') = (product_id IS NOT NULL)",
            name="ck_register_observations_product_relation",
        ),
        sa.CheckConstraint(
            "source_gtin ~ '^[0-9]+$' AND length(source_gtin) IN (8, 12, 13, 14)",
            name="ck_register_observations_gtin_format",
        ),
        sa.CheckConstraint(
            "date_trunc('month', period)::date = period",
            name="ck_register_observations_month_period",
        ),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_register_observations"),
    )
    op.create_index(
        "ix_register_observations_period_kind",
        "register_observations",
        ["period", "source_kind"],
    )
    op.create_index(
        "ix_register_observations_store_period",
        "register_observations",
        ["store_id", "period"],
    )
    op.create_index(
        "ix_register_observations_product_period",
        "register_observations",
        ["product_id", "period"],
    )


def downgrade() -> None:
    op.drop_index("ix_register_observations_product_period", table_name="register_observations")
    op.drop_index("ix_register_observations_store_period", table_name="register_observations")
    op.drop_index("ix_register_observations_period_kind", table_name="register_observations")
    op.drop_table("register_observations")
