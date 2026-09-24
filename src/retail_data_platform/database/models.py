from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CHAR,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
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
        Index("ix_products_legacy_erp_code", "legacy_erp_code"),
        Index("ix_products_legacy_internal_code", "legacy_internal_code"),
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


class Store(Base):
    __tablename__ = "stores"
    __table_args__ = (
        UniqueConstraint("source_key", name="uq_stores_source_key"),
        UniqueConstraint("external_network_code", name="uq_stores_external_network_code"),
        UniqueConstraint("crm_code", name="uq_stores_crm_code"),
        UniqueConstraint("erp_code", name="uq_stores_erp_code"),
        UniqueConstraint("legacy_store_id", name="uq_stores_legacy_store_id"),
        CheckConstraint(
            "sales_area_sqm IS NULL OR sales_area_sqm >= 0", name="ck_stores_sales_area"
        ),
        CheckConstraint(
            "checkout_count IS NULL OR checkout_count >= 0", name="ck_stores_checkout_count"
        ),
        CheckConstraint(
            "(survey_validity_days IS NULL OR survey_validity_days >= 0) AND "
            "(planned_sales_visits IS NULL OR planned_sales_visits >= 0) AND "
            "(sales_visit_minutes IS NULL OR sales_visit_minutes >= 0) AND "
            "(planned_promoter_visits IS NULL OR planned_promoter_visits >= 0) AND "
            "(promoter_visit_minutes IS NULL OR promoter_visit_minutes >= 0) AND "
            "(planned_total_visits IS NULL OR planned_total_visits >= 0)",
            name="ck_stores_nonnegative_visit_planning",
        ),
        CheckConstraint(
            "annual_turnover_2025_millions IS NULL OR annual_turnover_2025_millions >= 0",
            name="ck_stores_turnover_2025",
        ),
        CheckConstraint(
            "annual_turnover_2024_millions IS NULL OR annual_turnover_2024_millions >= 0",
            name="ck_stores_turnover_2024",
        ),
        CheckConstraint(
            "annual_turnover_2023_millions IS NULL OR annual_turnover_2023_millions >= 0",
            name="ck_stores_turnover_2023",
        ),
        CheckConstraint(
            "october_2023_turnover_millions IS NULL OR october_2023_turnover_millions >= 0",
            name="ck_stores_turnover_october_2023",
        ),
        Index("ix_stores_retail_panel_code", "retail_panel_code"),
        Index("ix_stores_data_sharing_code", "data_sharing_code"),
        Index("ix_stores_retailer_code", "retailer_code"),
        Index("ix_stores_postal_code", "postal_code"),
        Index("ix_stores_sales_representative_code", "sales_representative_code"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        primary_key=True,
        server_default=text("uuidv7()"),
    )
    source_key: Mapped[str] = mapped_column(String(128))
    external_network_code: Mapped[str | None] = mapped_column(String(64))
    crm_code: Mapped[str | None] = mapped_column(String(64))
    erp_code: Mapped[str | None] = mapped_column(String(32))
    legacy_store_id: Mapped[str | None] = mapped_column(String(64))
    retail_panel_code: Mapped[str | None] = mapped_column(String(32))
    data_sharing_code: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str | None] = mapped_column(String(255))
    legal_name: Mapped[str | None] = mapped_column(String(255))
    address_line_1: Mapped[str | None] = mapped_column(String(255))
    address_line_2: Mapped[str | None] = mapped_column(String(255))
    department_code: Mapped[str | None] = mapped_column(String(8))
    postal_code: Mapped[str | None] = mapped_column(String(16))
    city: Mapped[str | None] = mapped_column(String(128))
    retailer_code: Mapped[str | None] = mapped_column(String(32))
    retailer_name: Mapped[str | None] = mapped_column(String(128))
    store_format: Mapped[str | None] = mapped_column(String(64))
    region_code: Mapped[str | None] = mapped_column(String(32))
    region_name: Mapped[str | None] = mapped_column(String(128))
    sales_representative_code: Mapped[str | None] = mapped_column(String(32))
    sales_representative_name: Mapped[str | None] = mapped_column(String(128))
    promoter_code: Mapped[str | None] = mapped_column(String(32))
    promoter_name: Mapped[str | None] = mapped_column(String(128))
    secondary_representative_code: Mapped[str | None] = mapped_column(String(32))
    secondary_representative_name: Mapped[str | None] = mapped_column(String(128))
    sales_area_sqm: Mapped[int | None]
    classification: Mapped[str | None] = mapped_column(String(64))
    segmentation: Mapped[str | None] = mapped_column(String(64))
    distribution_model: Mapped[str | None] = mapped_column(String(64))
    has_direct_sales_potential: Mapped[bool | None]
    survey_validity_days: Mapped[int | None]
    planned_sales_visits: Mapped[int | None]
    sales_visit_minutes: Mapped[int | None]
    planned_promoter_visits: Mapped[int | None]
    promoter_visit_minutes: Mapped[int | None]
    planned_total_visits: Mapped[int | None]
    checkout_count: Mapped[int | None]
    annual_turnover_2025_millions: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    annual_turnover_2024_millions: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    annual_turnover_2023_millions: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    october_2023_turnover_millions: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=text("now()"),
    )


class TypologySnapshot(Base):
    __tablename__ = "typology_snapshots"
    __table_args__ = (
        UniqueConstraint("source_key", name="uq_typology_snapshots_source_key"),
        CheckConstraint(
            "store_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_typology_snapshots_match_status",
        ),
        Index("ix_typology_snapshots_period", "period"),
        Index("ix_typology_snapshots_store_period", "store_id", "period"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    source_key: Mapped[str] = mapped_column(CHAR(64))
    period: Mapped[date] = mapped_column(Date)
    store_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"))
    store_match_status: Mapped[str] = mapped_column(String(16))
    store_match_method: Mapped[str | None] = mapped_column(String(128))
    retail_panel_code: Mapped[str | None] = mapped_column(String(32))
    source_customer_code: Mapped[str | None] = mapped_column(String(64))
    point_of_sale_id: Mapped[str | None] = mapped_column(String(64))
    region_code: Mapped[str | None] = mapped_column(String(32))
    sales_representative_code: Mapped[str | None] = mapped_column(String(32))
    retailer_name: Mapped[str | None] = mapped_column(String(128))
    source_info: Mapped[str | None] = mapped_column(String(255))
    postal_code: Mapped[str | None] = mapped_column(String(16))


class StoreTypologyValue(Base):
    __tablename__ = "store_typology_values"
    __table_args__ = (
        UniqueConstraint(
            "snapshot_id", "category_key", name="uq_store_typology_values_snapshot_category"
        ),
        Index("ix_store_typology_values_category", "category_key", "typology_value"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    snapshot_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("typology_snapshots.id", ondelete="CASCADE")
    )
    category_key: Mapped[str] = mapped_column(String(128))
    category_name: Mapped[str] = mapped_column(String(128))
    typology_value: Mapped[str] = mapped_column(String(128))


class TypologyRankRule(Base):
    __tablename__ = "typology_rank_rules"
    __table_args__ = (
        UniqueConstraint(
            "retailer_name",
            "category_code",
            "rank",
            name="uq_typology_rank_rules_retailer_category_rank",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    retailer_name: Mapped[str] = mapped_column(String(128))
    category_name: Mapped[str] = mapped_column(String(128))
    category_code: Mapped[str] = mapped_column(String(32))
    rank: Mapped[int]
    typology_value: Mapped[str] = mapped_column(String(128))


class TypologyMappingRule(Base):
    __tablename__ = "typology_mapping_rules"
    __table_args__ = (UniqueConstraint("source_key", name="uq_typology_mapping_rules_source_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    source_key: Mapped[str] = mapped_column(CHAR(64))
    raw_retailer_name: Mapped[str] = mapped_column(String(128))
    raw_category_name: Mapped[str] = mapped_column(String(128))
    raw_category_code: Mapped[str | None] = mapped_column(String(32))
    raw_typology_value: Mapped[str] = mapped_column(String(128))
    mapped_retailer_name: Mapped[str | None] = mapped_column(String(128))
    mapped_category_code: Mapped[str | None] = mapped_column(String(32))
    mapped_typology_value: Mapped[str | None] = mapped_column(String(128))
    has_source_error: Mapped[bool] = mapped_column(Boolean)


class Assortment(Base):
    __tablename__ = "assortments"
    __table_args__ = (
        UniqueConstraint("source_key", name="uq_assortments_source_key"),
        CheckConstraint(
            "gtin ~ '^[0-9]+$' AND length(gtin) IN (8, 12, 13, 14)",
            name="ck_assortments_gtin_format",
        ),
        CheckConstraint(
            "product_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_assortments_product_match_status",
        ),
        CheckConstraint(
            "(product_match_status = 'matched') = (product_id IS NOT NULL)",
            name="ck_assortments_product_match_relation",
        ),
        CheckConstraint(
            "typology_match_status IN "
            "('unsegmented', 'unmapped', 'mapping_conflict', 'mapping_source_error', "
            "'rank_missing', 'rank_conflict', 'matched')",
            name="ck_assortments_typology_match_status",
        ),
        CheckConstraint(
            "(typology_match_status = 'matched') = (typology_rank_rule_id IS NOT NULL)",
            name="ck_assortments_rank_match_relation",
        ),
        CheckConstraint(
            "typology_mapping_rule_id IS NULL OR typology_match_status IN "
            "('mapping_source_error', 'rank_missing', 'rank_conflict', 'matched')",
            name="ck_assortments_mapping_match_relation",
        ),
        CheckConstraint(
            "(typology_match_status = 'matched') = (typology_match_method IS NOT NULL)",
            name="ck_assortments_typology_match_method_relation",
        ),
        CheckConstraint(
            "typology_match_method IS NULL OR "
            "typology_match_method IN ('mapping_rule', 'product_category')",
            name="ck_assortments_typology_match_method",
        ),
        CheckConstraint(
            "(typology_match_status = 'unsegmented') = (source_typology_value IS NULL)",
            name="ck_assortments_source_typology_relation",
        ),
        Index("ix_assortments_period", "period"),
        Index("ix_assortments_product_period", "product_id", "period"),
        Index("ix_assortments_typology_period", "typology_rank_rule_id", "period"),
        Index(
            "ix_assortments_reconciliation",
            "product_match_status",
            "typology_match_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    source_key: Mapped[str] = mapped_column(CHAR(64))
    period: Mapped[date] = mapped_column(Date)
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL")
    )
    product_match_status: Mapped[str] = mapped_column(String(16))
    typology_mapping_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("typology_mapping_rules.id", ondelete="SET NULL")
    )
    typology_rank_rule_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("typology_rank_rules.id", ondelete="SET NULL")
    )
    typology_match_status: Mapped[str] = mapped_column(String(32))
    typology_match_method: Mapped[str | None] = mapped_column(String(32))
    source_retailer_name: Mapped[str] = mapped_column(String(128))
    source_category_name: Mapped[str] = mapped_column(String(128))
    source_product_name: Mapped[str] = mapped_column(String(255))
    gtin: Mapped[str] = mapped_column(String(14))
    source_typology_value: Mapped[str | None] = mapped_column(String(128))


class StoreActivityMetric(Base):
    __tablename__ = "store_activity_metrics"
    __table_args__ = (
        UniqueConstraint("source_key", name="uq_store_activity_metrics_source_key"),
        CheckConstraint(
            "activity_type IN ('calls', 'crowdsourced_visits', 'field_visits')",
            name="ck_store_activity_metrics_type",
        ),
        CheckConstraint(
            "activity_count >= 0",
            name="ck_store_activity_metrics_nonnegative_count",
        ),
        CheckConstraint(
            "store_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_store_activity_metrics_match_status",
        ),
        CheckConstraint(
            "(store_match_status = 'matched') = (store_id IS NOT NULL)",
            name="ck_store_activity_metrics_store_relation",
        ),
        CheckConstraint(
            "(store_match_status = 'unresolved') = (store_match_method IS NULL)",
            name="ck_store_activity_metrics_method_relation",
        ),
        CheckConstraint(
            "date_trunc('month', period)::date = period",
            name="ck_store_activity_metrics_month_period",
        ),
        Index("ix_store_activity_metrics_period", "period"),
        Index(
            "ix_store_activity_metrics_store_period",
            "store_id",
            "period",
            "activity_type",
        ),
        Index(
            "ix_store_activity_metrics_reconciliation",
            "store_match_status",
            "activity_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    source_key: Mapped[str] = mapped_column(CHAR(64))
    period: Mapped[date] = mapped_column(Date)
    store_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"))
    store_match_status: Mapped[str] = mapped_column(String(16))
    store_match_method: Mapped[str | None] = mapped_column(String(128))
    activity_type: Mapped[str] = mapped_column(String(32))
    activity_count: Mapped[int]
    source_store_reference: Mapped[str] = mapped_column(String(128))
    source_store_label: Mapped[str] = mapped_column(String(512))


class NumericDistributionObservation(Base):
    __tablename__ = "numeric_distribution_observations"
    __table_args__ = (
        UniqueConstraint(
            "source_key",
            name="uq_numeric_distribution_observations_source_key",
        ),
        CheckConstraint(
            "presence_value IN (0, 1)",
            name="ck_numeric_distribution_observations_binary_value",
        ),
        CheckConstraint(
            "value_origin IN ('reported', 'inferred_absence')",
            name="ck_numeric_distribution_observations_value_origin",
        ),
        CheckConstraint(
            "value_origin != 'inferred_absence' OR presence_value = 0",
            name="ck_numeric_distribution_observations_inferred_value",
        ),
        CheckConstraint(
            "store_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_numeric_distribution_observations_store_status",
        ),
        CheckConstraint(
            "product_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_numeric_distribution_observations_product_status",
        ),
        CheckConstraint(
            "(store_match_status = 'matched') = (store_id IS NOT NULL)",
            name="ck_numeric_distribution_observations_store_relation",
        ),
        CheckConstraint(
            "(product_match_status = 'matched') = (product_id IS NOT NULL)",
            name="ck_numeric_distribution_observations_product_relation",
        ),
        CheckConstraint(
            "(store_match_status = 'unresolved') = (store_match_method IS NULL)",
            name="ck_numeric_distribution_observations_store_method",
        ),
        CheckConstraint(
            "(product_match_status = 'unresolved') = (product_match_method IS NULL)",
            name="ck_numeric_distribution_observations_product_method",
        ),
        CheckConstraint(
            "date_trunc('month', period)::date = period",
            name="ck_numeric_distribution_observations_month_period",
        ),
        Index("ix_numeric_distribution_observations_period", "period"),
        Index(
            "ix_numeric_distribution_observations_category_period",
            "category_code",
            "period",
        ),
        Index(
            "ix_numeric_distribution_observations_store_product_period",
            "store_id",
            "product_id",
            "period",
        ),
        Index(
            "ix_numeric_distribution_observations_reconciliation",
            "store_match_status",
            "product_match_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    source_key: Mapped[str] = mapped_column(CHAR(64))
    period: Mapped[date] = mapped_column(Date)
    category_code: Mapped[str] = mapped_column(String(32))
    store_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"))
    store_match_status: Mapped[str] = mapped_column(String(16))
    store_match_method: Mapped[str | None] = mapped_column(String(128))
    product_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL")
    )
    product_match_status: Mapped[str] = mapped_column(String(16))
    product_match_method: Mapped[str | None] = mapped_column(String(128))
    presence_value: Mapped[int] = mapped_column(SmallInteger)
    value_origin: Mapped[str] = mapped_column(String(24))
    source_category_name: Mapped[str] = mapped_column(String(128))
    source_store_reference: Mapped[str] = mapped_column(String(128))
    source_store_label: Mapped[str] = mapped_column(String(512))
    source_product_reference: Mapped[str] = mapped_column(String(128))
    source_product_label: Mapped[str] = mapped_column(String(512))


class ShelfShareObservation(Base):
    __tablename__ = "shelf_share_observations"
    __table_args__ = (
        UniqueConstraint("source_key", name="uq_shelf_share_observations_source_key"),
        CheckConstraint(
            "store_match_status IN ('matched', 'unresolved', 'conflict')",
            name="ck_shelf_share_observations_store_status",
        ),
        CheckConstraint(
            "(store_match_status = 'matched') = (store_id IS NOT NULL)",
            name="ck_shelf_share_observations_store_relation",
        ),
        CheckConstraint(
            "(store_match_status = 'unresolved') = (store_match_method IS NULL)",
            name="ck_shelf_share_observations_method_relation",
        ),
        CheckConstraint(
            "company_value >= 0 AND total_value >= 0",
            name="ck_shelf_share_observations_nonnegative_values",
        ),
        CheckConstraint(
            "(total_value = 0) = (share IS NULL)",
            name="ck_shelf_share_observations_share_relation",
        ),
        CheckConstraint(
            "source_row_count > 0",
            name="ck_shelf_share_observations_source_row_count",
        ),
        CheckConstraint(
            "date_trunc('month', period)::date = period",
            name="ck_shelf_share_observations_month_period",
        ),
        Index("ix_shelf_share_observations_period_category", "period", "category_code"),
        Index("ix_shelf_share_observations_store_period", "store_id", "period"),
        Index("ix_shelf_share_observations_reconciliation", "store_match_status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    source_key: Mapped[str] = mapped_column(CHAR(64))
    period: Mapped[date] = mapped_column(Date)
    category_code: Mapped[str] = mapped_column(String(32))
    store_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stores.id", ondelete="SET NULL"))
    store_match_status: Mapped[str] = mapped_column(String(16))
    store_match_method: Mapped[str | None] = mapped_column(String(128))
    company_value: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    total_value: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    share: Mapped[Decimal | None] = mapped_column(Numeric(12, 8))
    source_row_count: Mapped[int]
    source_category_name: Mapped[str] = mapped_column(String(128))
    source_store_reference: Mapped[str] = mapped_column(String(128))
    source_store_label: Mapped[str] = mapped_column(String(512))
