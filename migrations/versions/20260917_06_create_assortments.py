"""Create normalized monthly assortments."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260917_06"
down_revision: str | None = "20260916_05"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assortments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_key", sa.CHAR(length=64), nullable=False),
        sa.Column("period", sa.Date(), nullable=False),
        sa.Column("product_id", sa.Uuid(), nullable=True),
        sa.Column("product_match_status", sa.String(length=16), nullable=False),
        sa.Column("typology_mapping_rule_id", sa.Uuid(), nullable=True),
        sa.Column("typology_rank_rule_id", sa.Uuid(), nullable=True),
        sa.Column("typology_match_status", sa.String(length=32), nullable=False),
        sa.Column("typology_match_method", sa.String(length=32), nullable=True),
        sa.Column("source_retailer_name", sa.String(length=128), nullable=False),
        sa.Column("source_category_name", sa.String(length=128), nullable=False),
        sa.Column("source_product_name", sa.String(length=255), nullable=False),
        sa.Column("gtin", sa.String(length=14), nullable=False),
        sa.Column("source_typology_value", sa.String(length=128), nullable=True),
        sa.CheckConstraint(
            "gtin ~ '^[0-9]+$' AND length(gtin) IN (8, 12, 13, 14)",
            name="ck_assortments_gtin_format",
        ),
        sa.CheckConstraint(
            "product_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_assortments_product_match_status",
        ),
        sa.CheckConstraint(
            "(product_match_status = 'matched') = (product_id IS NOT NULL)",
            name="ck_assortments_product_match_relation",
        ),
        sa.CheckConstraint(
            "typology_match_status IN "
            "('unsegmented', 'unmapped', 'mapping_conflict', 'mapping_source_error', "
            "'rank_missing', 'rank_conflict', 'matched')",
            name="ck_assortments_typology_match_status",
        ),
        sa.CheckConstraint(
            "(typology_match_status = 'matched') = (typology_rank_rule_id IS NOT NULL)",
            name="ck_assortments_rank_match_relation",
        ),
        sa.CheckConstraint(
            "typology_mapping_rule_id IS NULL OR typology_match_status IN "
            "('mapping_source_error', 'rank_missing', 'rank_conflict', 'matched')",
            name="ck_assortments_mapping_match_relation",
        ),
        sa.CheckConstraint(
            "(typology_match_status = 'matched') = (typology_match_method IS NOT NULL)",
            name="ck_assortments_typology_match_method_relation",
        ),
        sa.CheckConstraint(
            "typology_match_method IS NULL OR "
            "typology_match_method IN ('mapping_rule', 'product_category')",
            name="ck_assortments_typology_match_method",
        ),
        sa.CheckConstraint(
            "(typology_match_status = 'unsegmented') = (source_typology_value IS NULL)",
            name="ck_assortments_source_typology_relation",
        ),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["typology_mapping_rule_id"],
            ["typology_mapping_rules.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["typology_rank_rule_id"],
            ["typology_rank_rules.id"],
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_assortments"),
        sa.UniqueConstraint("source_key", name="uq_assortments_source_key"),
    )
    op.create_index("ix_assortments_period", "assortments", ["period"])
    op.create_index("ix_assortments_product_period", "assortments", ["product_id", "period"])
    op.create_index(
        "ix_assortments_typology_period",
        "assortments",
        ["typology_rank_rule_id", "period"],
    )
    op.create_index(
        "ix_assortments_reconciliation",
        "assortments",
        ["product_match_status", "typology_match_status"],
    )


def downgrade() -> None:
    op.drop_index("ix_assortments_reconciliation", table_name="assortments")
    op.drop_index("ix_assortments_typology_period", table_name="assortments")
    op.drop_index("ix_assortments_product_period", table_name="assortments")
    op.drop_index("ix_assortments_period", table_name="assortments")
    op.drop_table("assortments")
