"""Create import run audit table."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260915_01"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "import_runs",
        sa.Column("id", sa.Uuid(), server_default=sa.text("uuidv7()"), nullable=False),
        sa.Column("dataset", sa.String(length=64), nullable=False),
        sa.Column("source_file_name", sa.String(length=255), nullable=False),
        sa.Column("source_sha256", sa.CHAR(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("rows_read", sa.Integer(), server_default="0", nullable=False),
        sa.Column("rows_inserted", sa.Integer(), server_default="0", nullable=False),
        sa.Column("rows_rejected", sa.Integer(), server_default="0", nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('running', 'succeeded', 'failed')",
            name="ck_import_runs_status",
        ),
        sa.CheckConstraint(
            "rows_read >= 0 AND rows_inserted >= 0 AND rows_rejected >= 0",
            name="ck_import_runs_nonnegative_counts",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_import_runs"),
    )
    op.create_index(
        "uq_import_runs_succeeded_source",
        "import_runs",
        ["dataset", "source_sha256"],
        unique=True,
        postgresql_where=sa.text("status = 'succeeded'"),
    )


def downgrade() -> None:
    op.drop_index("uq_import_runs_succeeded_source", table_name="import_runs")
    op.drop_table("import_runs")
