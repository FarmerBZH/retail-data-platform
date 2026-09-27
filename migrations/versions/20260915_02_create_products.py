"""Create product catalog table."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260915_02"
down_revision: str | None = "20260915_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("gtin", sa.String(length=14), nullable=False),
        sa.Column("erp_code", sa.String(length=32), nullable=True),
        sa.Column("internal_code", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("brand", sa.String(length=128), nullable=False),
        sa.Column("market", sa.String(length=128), nullable=False),
        sa.Column("category", sa.String(length=128), nullable=False),
        sa.Column("segment", sa.String(length=128), nullable=True),
        sa.Column("content_quantity", sa.Numeric(precision=12, scale=3), nullable=True),
        sa.Column("content_unit", sa.String(length=32), nullable=True),
        sa.Column("average_price", sa.Numeric(precision=12, scale=2), nullable=True),
        sa.Column("average_price_currency", sa.CHAR(length=3), nullable=True),
        sa.Column("category_code", sa.String(length=32), nullable=False),
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
            "gtin ~ '^[0-9]+$' AND length(gtin) IN (8, 12, 13, 14)",
            name="ck_products_gtin_format",
        ),
        sa.CheckConstraint(
            "content_quantity IS NULL OR content_quantity >= 0",
            name="ck_products_nonnegative_content_quantity",
        ),
        sa.CheckConstraint(
            "average_price IS NULL OR average_price >= 0",
            name="ck_products_nonnegative_average_price",
        ),
        sa.CheckConstraint(
            "(average_price IS NULL) = (average_price_currency IS NULL)",
            name="ck_products_price_pair",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_products"),
        sa.UniqueConstraint("erp_code", name="uq_products_erp_code"),
        sa.UniqueConstraint("gtin", name="uq_products_gtin"),
    )


def downgrade() -> None:
    op.drop_table("products")
