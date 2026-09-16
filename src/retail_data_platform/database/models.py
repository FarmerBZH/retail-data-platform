from __future__ import annotations

import enum
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CHAR,
    Boolean,
    CheckConstraint,
    DateTime,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from retail_data_platform.database.base import Base


class ImportStatus(enum.StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class ImportRun(Base):
    __tablename__ = "import_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('running', 'succeeded', 'failed')",
            name="ck_import_runs_status",
        ),
        CheckConstraint(
            "rows_read >= 0 AND rows_inserted >= 0 AND rows_rejected >= 0",
            name="ck_import_runs_nonnegative_counts",
        ),
        Index(
            "uq_import_runs_succeeded_source",
            "dataset",
            "source_sha256",
            unique=True,
            postgresql_where=text("status = 'succeeded'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        server_default=text("uuidv7()"),
    )
    dataset: Mapped[str] = mapped_column(String(64))
    source_file_name: Mapped[str] = mapped_column(String(255))
    source_sha256: Mapped[str] = mapped_column(CHAR(64))
    status: Mapped[str] = mapped_column(String(16))
    rows_read: Mapped[int] = mapped_column(default=0, server_default="0")
    rows_inserted: Mapped[int] = mapped_column(default=0, server_default="0")
    rows_rejected: Mapped[int] = mapped_column(default=0, server_default="0")
    error_message: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("gtin", name="uq_products_gtin"),
        UniqueConstraint("erp_code", name="uq_products_erp_code"),
        CheckConstraint(
            "gtin ~ '^[0-9]+$' AND length(gtin) IN (8, 12, 13, 14)",
            name="ck_products_gtin_format",
        ),
        CheckConstraint(
            "content_quantity IS NULL OR content_quantity >= 0",
            name="ck_products_nonnegative_content_quantity",
        ),
        CheckConstraint(
            "average_price IS NULL OR average_price >= 0",
            name="ck_products_nonnegative_average_price",
        ),
        CheckConstraint(
            "(average_price IS NULL) = (average_price_currency IS NULL)",
            name="ck_products_price_pair",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        server_default=text("uuidv7()"),
    )
    gtin: Mapped[str] = mapped_column(String(14))
    erp_code: Mapped[str | None] = mapped_column(String(32))
    legacy_erp_code: Mapped[str | None] = mapped_column(String(32))
    internal_code: Mapped[str] = mapped_column(String(64))
    legacy_internal_code: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(255))
    brand: Mapped[str | None] = mapped_column(String(128))
    market: Mapped[str | None] = mapped_column(String(128))
    category: Mapped[str | None] = mapped_column(String(128))
    segment: Mapped[str | None] = mapped_column(String(128))
    content_quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    content_unit: Mapped[str | None] = mapped_column(String(32))
    average_price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    average_price_currency: Mapped[str | None] = mapped_column(CHAR(3))
    category_code: Mapped[str | None] = mapped_column(String(32))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )
