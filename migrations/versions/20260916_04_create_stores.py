"""Create the store catalog table."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260916_04"
down_revision: str | None = "20260916_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "stores",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("source_key", sa.String(length=128), nullable=False),
        sa.Column("external_network_code", sa.String(length=64), nullable=True),
        sa.Column("crm_code", sa.String(length=64), nullable=True),
        sa.Column("erp_code", sa.String(length=32), nullable=True),
        sa.Column("legacy_store_id", sa.String(length=64), nullable=True),
        sa.Column("retail_panel_code", sa.String(length=32), nullable=True),
        sa.Column("data_sharing_code", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("legal_name", sa.String(length=255), nullable=True),
        sa.Column("address_line_1", sa.String(length=255), nullable=True),
        sa.Column("address_line_2", sa.String(length=255), nullable=True),
        sa.Column("department_code", sa.String(length=8), nullable=True),
        sa.Column("postal_code", sa.String(length=16), nullable=True),
        sa.Column("city", sa.String(length=128), nullable=True),
        sa.Column("retailer_code", sa.String(length=32), nullable=True),
        sa.Column("retailer_name", sa.String(length=128), nullable=True),
        sa.Column("store_format", sa.String(length=64), nullable=True),
        sa.Column("region_code", sa.String(length=32), nullable=True),
        sa.Column("region_name", sa.String(length=128), nullable=True),
        sa.Column("sales_representative_code", sa.String(length=32), nullable=True),
        sa.Column("sales_representative_name", sa.String(length=128), nullable=True),
        sa.Column("promoter_code", sa.String(length=32), nullable=True),
        sa.Column("promoter_name", sa.String(length=128), nullable=True),
        sa.Column("secondary_representative_code", sa.String(length=32), nullable=True),
        sa.Column("secondary_representative_name", sa.String(length=128), nullable=True),
        sa.Column("sales_area_sqm", sa.Integer(), nullable=True),
        sa.Column("classification", sa.String(length=64), nullable=True),
        sa.Column("segmentation", sa.String(length=64), nullable=True),
        sa.Column("distribution_model", sa.String(length=64), nullable=True),
        sa.Column("has_direct_sales_potential", sa.Boolean(), nullable=True),
        sa.Column("survey_validity_days", sa.Integer(), nullable=True),
        sa.Column("planned_sales_visits", sa.Integer(), nullable=True),
        sa.Column("sales_visit_minutes", sa.Integer(), nullable=True),
        sa.Column("planned_promoter_visits", sa.Integer(), nullable=True),
        sa.Column("promoter_visit_minutes", sa.Integer(), nullable=True),
        sa.Column("planned_total_visits", sa.Integer(), nullable=True),
        sa.Column("checkout_count", sa.Integer(), nullable=True),
        sa.Column("annual_turnover_2025_millions", sa.Numeric(12, 2), nullable=True),
        sa.Column("annual_turnover_2024_millions", sa.Numeric(12, 2), nullable=True),
        sa.Column("annual_turnover_2023_millions", sa.Numeric(12, 2), nullable=True),
        sa.Column("october_2023_turnover_millions", sa.Numeric(12, 2), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "sales_area_sqm IS NULL OR sales_area_sqm >= 0", name="ck_stores_sales_area"
        ),
        sa.CheckConstraint(
            "checkout_count IS NULL OR checkout_count >= 0", name="ck_stores_checkout_count"
        ),
        sa.CheckConstraint(
            "(survey_validity_days IS NULL OR survey_validity_days >= 0) AND "
            "(planned_sales_visits IS NULL OR planned_sales_visits >= 0) AND "
            "(sales_visit_minutes IS NULL OR sales_visit_minutes >= 0) AND "
            "(planned_promoter_visits IS NULL OR planned_promoter_visits >= 0) AND "
            "(promoter_visit_minutes IS NULL OR promoter_visit_minutes >= 0) AND "
            "(planned_total_visits IS NULL OR planned_total_visits >= 0)",
            name="ck_stores_nonnegative_visit_planning",
        ),
        sa.CheckConstraint(
            "annual_turnover_2025_millions IS NULL OR annual_turnover_2025_millions >= 0",
            name="ck_stores_turnover_2025",
        ),
        sa.CheckConstraint(
            "annual_turnover_2024_millions IS NULL OR annual_turnover_2024_millions >= 0",
            name="ck_stores_turnover_2024",
        ),
        sa.CheckConstraint(
            "annual_turnover_2023_millions IS NULL OR annual_turnover_2023_millions >= 0",
            name="ck_stores_turnover_2023",
        ),
        sa.CheckConstraint(
            "october_2023_turnover_millions IS NULL OR october_2023_turnover_millions >= 0",
            name="ck_stores_turnover_october_2023",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_stores"),
        sa.UniqueConstraint("crm_code", name="uq_stores_crm_code"),
        sa.UniqueConstraint("erp_code", name="uq_stores_erp_code"),
        sa.UniqueConstraint("external_network_code", name="uq_stores_external_network_code"),
        sa.UniqueConstraint("legacy_store_id", name="uq_stores_legacy_store_id"),
        sa.UniqueConstraint("source_key", name="uq_stores_source_key"),
    )
    op.create_index("ix_stores_retail_panel_code", "stores", ["retail_panel_code"])
    op.create_index("ix_stores_data_sharing_code", "stores", ["data_sharing_code"])
    op.create_index("ix_stores_retailer_code", "stores", ["retailer_code"])
    op.create_index("ix_stores_postal_code", "stores", ["postal_code"])
    op.create_index("ix_stores_sales_representative_code", "stores", ["sales_representative_code"])


def downgrade() -> None:
    op.drop_table("stores")
