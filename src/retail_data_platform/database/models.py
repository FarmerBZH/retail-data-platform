from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import CHAR, CheckConstraint, DateTime, Index, String, Text, Uuid, text
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
