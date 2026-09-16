"""Support merged product sources and legacy identifiers."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260916_03"
down_revision: str | None = "20260915_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("products", sa.Column("legacy_erp_code", sa.String(length=32), nullable=True))
    op.add_column(
        "products", sa.Column("legacy_internal_code", sa.String(length=64), nullable=True)
    )
    op.alter_column("products", "brand", existing_type=sa.String(length=128), nullable=True)
    op.alter_column("products", "market", existing_type=sa.String(length=128), nullable=True)
    op.alter_column("products", "category", existing_type=sa.String(length=128), nullable=True)
    op.alter_column("products", "category_code", existing_type=sa.String(length=32), nullable=True)
    op.create_index("ix_products_legacy_erp_code", "products", ["legacy_erp_code"])
    op.create_index("ix_products_legacy_internal_code", "products", ["legacy_internal_code"])


def downgrade() -> None:
    op.drop_index("ix_products_legacy_internal_code", table_name="products")
    op.drop_index("ix_products_legacy_erp_code", table_name="products")
    op.execute(
        "DELETE FROM products "
        "WHERE brand IS NULL OR market IS NULL OR category IS NULL OR category_code IS NULL"
    )
    op.alter_column("products", "category_code", existing_type=sa.String(length=32), nullable=False)
    op.alter_column("products", "category", existing_type=sa.String(length=128), nullable=False)
    op.alter_column("products", "market", existing_type=sa.String(length=128), nullable=False)
    op.alter_column("products", "brand", existing_type=sa.String(length=128), nullable=False)
    op.drop_column("products", "legacy_internal_code")
    op.drop_column("products", "legacy_erp_code")
