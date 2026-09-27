"""Create normalized store typology tables."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260916_05"
down_revision: str | None = "20260916_04"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "typology_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_key", sa.CHAR(length=64), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("store_id", sa.Uuid(), nullable=True),
        sa.Column("store_match_status", sa.String(length=16), nullable=False),
        sa.Column("store_match_method", sa.String(length=128), nullable=True),
        sa.Column("retail_panel_code", sa.String(length=32), nullable=True),
        sa.Column("source_customer_code", sa.String(length=64), nullable=True),
        sa.Column("point_of_sale_id", sa.String(length=64), nullable=True),
        sa.Column("region_code", sa.String(length=32), nullable=True),
        sa.Column("sales_representative_code", sa.String(length=32), nullable=True),
        sa.Column("retailer_name", sa.String(length=128), nullable=True),
        sa.Column("source_info", sa.String(length=255), nullable=True),
        sa.Column("postal_code", sa.String(length=16), nullable=True),
        sa.CheckConstraint(
            "store_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_typology_snapshots_match_status",
        ),
        sa.ForeignKeyConstraint(["store_id"], ["stores.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_typology_snapshots"),
        sa.UniqueConstraint("source_key", name="uq_typology_snapshots_source_key"),
    )
    op.create_index("ix_typology_snapshots_period", "typology_snapshots", ["period"])
    op.create_index(
        "ix_typology_snapshots_store_period", "typology_snapshots", ["store_id", "period"]
    )
    op.create_table(
        "store_typology_values",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("snapshot_id", sa.Uuid(), nullable=False),
        sa.Column("category_key", sa.String(length=128), nullable=False),
        sa.Column("category_name", sa.String(length=128), nullable=False),
        sa.Column("typology_value", sa.String(length=128), nullable=False),
        sa.ForeignKeyConstraint(["snapshot_id"], ["typology_snapshots.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_store_typology_values"),
        sa.UniqueConstraint(
            "snapshot_id", "category_key", name="uq_store_typology_values_snapshot_category"
        ),
    )
    op.create_index(
        "ix_store_typology_values_category",
        "store_typology_values",
        ["category_key", "typology_value"],
    )
    op.create_table(
        "typology_rank_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("retailer_name", sa.String(length=128), nullable=False),
        sa.Column("category_name", sa.String(length=128), nullable=False),
        sa.Column("category_code", sa.String(length=32), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("typology_value", sa.String(length=128), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_typology_rank_rules"),
        sa.UniqueConstraint(
            "retailer_name",
            "category_code",
            "rank",
            name="uq_typology_rank_rules_retailer_category_rank",
        ),
    )
    op.create_table(
        "typology_mapping_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_key", sa.CHAR(length=64), nullable=False),
        sa.Column("raw_retailer_name", sa.String(length=128), nullable=False),
        sa.Column("raw_category_name", sa.String(length=128), nullable=False),
        sa.Column("raw_category_code", sa.String(length=32), nullable=True),
        sa.Column("raw_typology_value", sa.String(length=128), nullable=False),
        sa.Column("mapped_retailer_name", sa.String(length=128), nullable=True),
        sa.Column("mapped_category_code", sa.String(length=32), nullable=True),
        sa.Column("mapped_typology_value", sa.String(length=128), nullable=True),
        sa.Column("has_source_error", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_typology_mapping_rules"),
        sa.UniqueConstraint("source_key", name="uq_typology_mapping_rules_source_key"),
    )


def downgrade() -> None:
    op.drop_table("typology_mapping_rules")
    op.drop_table("typology_rank_rules")
    op.drop_index("ix_store_typology_values_category", table_name="store_typology_values")
    op.drop_table("store_typology_values")
    op.drop_index("ix_typology_snapshots_store_period", table_name="typology_snapshots")
    op.drop_index("ix_typology_snapshots_period", table_name="typology_snapshots")
    op.drop_table("typology_snapshots")
