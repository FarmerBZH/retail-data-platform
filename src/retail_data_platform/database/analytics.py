"""Read mappings for materialized analytical views, separate from table metadata.

Primary keys describe each view's grain for SQLAlchemy identity mapping. They
are backed by unique indexes in PostgreSQL. Query these models using SELECT only.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, Integer, Numeric, SmallInteger, String, Text, Uuid
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class AnalyticsBase(DeclarativeBase):
    """Materialized view mappings, refreshed together; never use create_all."""


class RegisterProductMonth(AnalyticsBase):
    __tablename__ = "analytics_register_product_month"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    source_gtin: Mapped[str] = mapped_column(String(14), primary_key=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    source_row_count: Mapped[int | None] = mapped_column(BigInteger)
    ambiguous: Mapped[bool | None] = mapped_column(Boolean)
    unmatched_product_rows: Mapped[int | None] = mapped_column(BigInteger)
    observation_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(Uuid))
    source_kinds: Mapped[list[str] | None] = mapped_column(ARRAY(String))
    revenue: Mapped[Decimal | None] = mapped_column(Numeric)
    units: Mapped[int | None] = mapped_column(BigInteger)
    volume: Mapped[Decimal | None] = mapped_column(Numeric)
    revenue_reported_rows: Mapped[int | None] = mapped_column(BigInteger)
    units_reported_rows: Mapped[int | None] = mapped_column(BigInteger)


class ActivityMonth(AnalyticsBase):
    __tablename__ = "analytics_activity_month"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    activity_type: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_row_count: Mapped[int | None] = mapped_column(BigInteger)
    ambiguous: Mapped[bool | None] = mapped_column(Boolean)
    activity_count: Mapped[int | None] = mapped_column(Integer)
    observation_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(Uuid))


class DistributionProductMonth(AnalyticsBase):
    __tablename__ = "analytics_distribution_product_month"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    category_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    product_key: Mapped[str] = mapped_column(Text, primary_key=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    source_row_count: Mapped[int | None] = mapped_column(BigInteger)
    ambiguous: Mapped[bool | None] = mapped_column(Boolean)
    presence_value: Mapped[int | None] = mapped_column(SmallInteger)
    inferred_absence_rows: Mapped[int | None] = mapped_column(BigInteger)
    observation_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(Uuid))


class ShelfCategoryMonth(AnalyticsBase):
    __tablename__ = "analytics_shelf_category_month"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    category_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    source_row_count: Mapped[int | None] = mapped_column(BigInteger)
    ambiguous: Mapped[bool | None] = mapped_column(Boolean)
    company_value: Mapped[Decimal | None] = mapped_column(Numeric)
    total_value: Mapped[Decimal | None] = mapped_column(Numeric)
    shelf_share: Mapped[Decimal | None] = mapped_column(Numeric)
    observation_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(Uuid))


class TypologyMonth(AnalyticsBase):
    __tablename__ = "analytics_typology_month"
    store_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    period: Mapped[date | None] = mapped_column(Date)
    typology_value_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    snapshot_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    retailer_name: Mapped[str | None] = mapped_column(String(128))
    region_code: Mapped[str | None] = mapped_column(String(32))
    sales_representative_code: Mapped[str | None] = mapped_column(String(32))
    category_key: Mapped[str | None] = mapped_column(String(128))
    category_name: Mapped[str | None] = mapped_column(String(128))
    typology_value: Mapped[str | None] = mapped_column(String(128))
    rank_rule_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(Uuid))
    rank_candidate_count: Mapped[int | None] = mapped_column(Integer)
    mapping_issue: Mapped[bool | None] = mapped_column(Boolean)


class AssortmentCandidates(AnalyticsBase):
    __tablename__ = "analytics_assortment_candidates"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    assortment_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    gtin: Mapped[str | None] = mapped_column(String(14))
    typology_rank_rule_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    typology_value_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(Uuid))


class RetailerAssortmentMonth(AnalyticsBase):
    __tablename__ = "analytics_retailer_assortment_month"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    assortment_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    product_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    gtin: Mapped[str | None] = mapped_column(String(14))
    product_match_status: Mapped[str | None] = mapped_column(String(16))
    typology_match_status: Mapped[str | None] = mapped_column(String(32))


class StoreCategoryMonth(AnalyticsBase):
    __tablename__ = "analytics_store_category_month"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    category_code: Mapped[str] = mapped_column(String(32), primary_key=True)
    distribution_product_count: Mapped[int | None] = mapped_column(BigInteger)
    distribution_ambiguous_products: Mapped[int | None] = mapped_column(BigInteger)
    distribution_unmatched_products: Mapped[int | None] = mapped_column(BigInteger)
    inferred_absence_rows: Mapped[Decimal | None] = mapped_column(Numeric)
    present_products: Mapped[int | None] = mapped_column(BigInteger)
    observed_presence_rate: Mapped[Decimal | None] = mapped_column(Numeric)
    shelf_source_row_count: Mapped[int | None] = mapped_column(BigInteger)
    shelf_ambiguous: Mapped[bool | None] = mapped_column(Boolean)
    shelf_company_value: Mapped[Decimal | None] = mapped_column(Numeric)
    shelf_total_value: Mapped[Decimal | None] = mapped_column(Numeric)
    shelf_share: Mapped[Decimal | None] = mapped_column(Numeric)
    exact_assortment_candidate_count: Mapped[int | None] = mapped_column(BigInteger)


class MonthlyLinkQuality(AnalyticsBase):
    __tablename__ = "analytics_monthly_link_quality"
    dataset: Mapped[str] = mapped_column(Text, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    store_match_status: Mapped[str] = mapped_column(String(16), primary_key=True)
    source_row_count: Mapped[int | None] = mapped_column(BigInteger)


class StoreMonth(AnalyticsBase):
    __tablename__ = "analytics_store_month"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    current_store_name: Mapped[str | None] = mapped_column(String(255))
    current_retailer_name: Mapped[str | None] = mapped_column(String(128))
    current_store_format: Mapped[str | None] = mapped_column(String(64))
    current_region_code: Mapped[str | None] = mapped_column(String(32))
    current_is_active: Mapped[bool | None] = mapped_column(Boolean)
    current_store: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    register_product_count: Mapped[int | None] = mapped_column(BigInteger)
    register_source_row_count: Mapped[Decimal | None] = mapped_column(Numeric)
    register_ambiguous_products: Mapped[int | None] = mapped_column(BigInteger)
    register_unmatched_product_rows: Mapped[Decimal | None] = mapped_column(Numeric)
    register_revenue_product_count: Mapped[int | None] = mapped_column(BigInteger)
    register_units_product_count: Mapped[int | None] = mapped_column(BigInteger)
    revenue: Mapped[Decimal | None] = mapped_column(Numeric)
    units: Mapped[Decimal | None] = mapped_column(Numeric)
    revenue_per_unit: Mapped[Decimal | None] = mapped_column(Numeric)
    unambiguous_reported_revenue: Mapped[Decimal | None] = mapped_column(Numeric)
    unambiguous_reported_units: Mapped[Decimal | None] = mapped_column(Numeric)
    calls: Mapped[int | None] = mapped_column(Integer)
    field_visits: Mapped[int | None] = mapped_column(Integer)
    crowdsourced_visits: Mapped[int | None] = mapped_column(Integer)
    activity_ambiguous_types: Mapped[int | None] = mapped_column(BigInteger)
    activity_details: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    category_details: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    typology_details: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    typology_snapshot_count: Mapped[int | None] = mapped_column(BigInteger)
    typology_snapshot_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(Uuid))
    has_register: Mapped[bool | None] = mapped_column(Boolean)
    has_activity: Mapped[bool | None] = mapped_column(Boolean)
    has_category_data: Mapped[bool | None] = mapped_column(Boolean)
    has_typology: Mapped[bool | None] = mapped_column(Boolean)


class StoreMonthChanges(AnalyticsBase):
    __tablename__ = "analytics_store_month_changes"
    store_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    period: Mapped[date] = mapped_column(Date, primary_key=True)
    revenue: Mapped[Decimal | None] = mapped_column(Numeric)
    units: Mapped[Decimal | None] = mapped_column(Numeric)
    calls: Mapped[int | None] = mapped_column(Integer)
    field_visits: Mapped[int | None] = mapped_column(Integer)
    crowdsourced_visits: Mapped[int | None] = mapped_column(Integer)
    revenue_previous_month: Mapped[Decimal | None] = mapped_column(Numeric)
    revenue_previous_year: Mapped[Decimal | None] = mapped_column(Numeric)
    units_previous_month: Mapped[Decimal | None] = mapped_column(Numeric)
    calls_previous_month: Mapped[int | None] = mapped_column(Integer)
    field_visits_previous_month: Mapped[int | None] = mapped_column(Integer)
    crowdsourced_visits_previous_month: Mapped[int | None] = mapped_column(Integer)
    revenue_month_change: Mapped[Decimal | None] = mapped_column(Numeric)
    revenue_month_change_ratio: Mapped[Decimal | None] = mapped_column(Numeric)
    revenue_year_change_ratio: Mapped[Decimal | None] = mapped_column(Numeric)
