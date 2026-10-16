"""Explicit query and response contracts for published, filtered analysis."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from retail_data_platform.database.network_analysis import Scope, Window


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ErrorResponse(Contract):
    error: str


class AnalysisQuery(Contract):
    scope: Literal["all", "selection"] = "all"
    store_ids: list[UUID] = Field(default_factory=list, max_length=100)
    retailer_name: str | None = Field(default=None, max_length=128)
    region_code: str | None = Field(default=None, max_length=32)
    store_format: str | None = Field(default=None, max_length=64)
    activity_status: Literal["all", "active", "inactive"] = "all"
    publication_id: UUID | None = None

    def domain_scope(self) -> Scope:
        return Scope(
            self.scope,
            tuple(sorted(self.store_ids)),
            self.retailer_name,
            self.region_code,
            self.store_format,
            self.activity_status,
        )

    @model_validator(mode="after")
    def valid_scope(self) -> AnalysisQuery:
        self.domain_scope()
        return self


class WindowQuery(AnalysisQuery):
    period_from: date
    period_to: date
    comparison: Literal["previous", "previous_year"] = "previous"

    def domain_window(self) -> Window:
        return Window(self.period_from, self.period_to)

    @model_validator(mode="after")
    def valid_window(self) -> WindowQuery:
        self.domain_window().reference(self.comparison)
        return self


class StoresQuery(AnalysisQuery):
    q: str | None = Field(default=None, min_length=1, max_length=128)
    limit: int = Field(default=50, ge=1, le=200)
    after: str | None = Field(default=None, min_length=1, max_length=8192)


class DimensionsQuery(StoresQuery):
    dimension: Literal["retailer_name", "region_code", "store_format"]


class AvailabilityQuery(AnalysisQuery):
    period_from: date | None = None
    period_to: date | None = None

    @model_validator(mode="after")
    def valid_window(self) -> AvailabilityQuery:
        if (self.period_from is None) != (self.period_to is None):
            raise ValueError("invalid_window")
        if self.period_from is not None and self.period_to is not None:
            Window(self.period_from, self.period_to).reference("previous")
        return self


class RankingQuery(WindowQuery):
    sort: Literal["revenue", "revenue_change"] = "revenue"
    direction: Literal["asc", "desc"] = "desc"
    limit: int = Field(default=50, ge=1, le=200)
    after: str | None = Field(default=None, min_length=1, max_length=8192)


class StoreSeriesQuery(WindowQuery):
    limit: int = Field(default=6, ge=1, le=6)
    after: str | None = Field(default=None, min_length=1, max_length=8192)


class ScopeContext(Contract):
    scope: Literal["all", "selection"]
    store_ids: list[UUID]
    retailer_name: str | None
    region_code: str | None
    store_format: str | None
    activity_status: Literal["all", "active", "inactive"]
    requested_store_count: int | None
    resolved_store_count: int
    filtered_out_store_count: int
    scope_store_count: int


class PeriodWindow(Contract):
    start: date
    end: date
    months: int


class Freshness(Contract):
    state: Literal["current", "stale"]
    last_completed_at: datetime
    last_attempt_status: Literal["running", "succeeded", "failed"] | None


class Context(Contract):
    publication_id: UUID
    freshness: Freshness
    scope: ScopeContext
    window: PeriodWindow | None
    reference: PeriodWindow | None
    comparison: Literal["previous", "previous_year"] | None


class StoreItem(Contract):
    store_id: UUID
    name: str | None
    city: str | None
    retailer_name: str | None
    region_code: str | None
    store_format: str | None
    is_active: bool


class Page[T](Contract):
    context: Context
    items: list[T]
    next_cursor: str | None


class DimensionItem(Contract):
    value: str


class DimensionPage(Page[DimensionItem]):
    dimension: Literal["retailer_name", "region_code", "store_format"]
    missing_store_count: int


class Measure(Contract):
    value: Decimal | None
    partial: Decimal | None
    covered_cell_count: int
    expected_cell_count: int


class Change(Contract):
    difference: Decimal | None
    ratio: Decimal | None
    reference_state: Literal["missing", "zero", "negative", "positive"]


class Cohort(Contract):
    store_count: int
    excluded_store_count: int
    expected_cell_count: int
    current: Decimal | None
    reference: Decimal | None
    change: Change


class Metric(Contract):
    current: Measure
    reference: Measure
    change: Change
    cohort: Cohort


class Metrics(Contract):
    revenue: Metric
    units: Metric
    calls: Metric
    field_visits: Metric
    crowdsourced_visits: Metric


class UnitRevenue(Contract):
    current: Decimal | None
    reference: Decimal | None
    cohort_current: Decimal | None
    cohort_reference: Decimal | None
    cohort_store_count: int


class Summary(Contract):
    context: Context
    metrics: Metrics
    revenue_per_unit: UnitRevenue
    revenue_contribution_sum: Decimal | None


class PointMetric(Contract):
    current: Measure
    reference: Measure
    cohort_store_count: int
    cohort_current: Decimal | None
    cohort_reference: Decimal | None


class PointMetrics(Contract):
    revenue: PointMetric
    units: PointMetric
    calls: PointMetric
    field_visits: PointMetric
    crowdsourced_visits: PointMetric


class Point(Contract):
    period: date
    reference_period: date
    metrics: PointMetrics


class Series(Contract):
    context: Context
    items: list[Point]


class StoreSeries(Contract):
    store: StoreItem
    points: list[Point]


class RankingItem(StoreItem):
    rank: int
    current_revenue: Decimal | None
    reference_revenue: Decimal | None
    current_revenue_partial: Decimal | None
    reference_revenue_partial: Decimal | None
    current_revenue_covered: int
    reference_revenue_covered: int
    expected_month_count: int
    revenue_change: Decimal | None
    exclusion_reason: Literal["missing_month", "ambiguous_measure", "missing_measure"] | None


class AvailabilityMonth(Contract):
    period: date
    has_observation: bool
    source_row_count: int | None
    observed_row_count: int | None
    inferred_absence_row_count: int | None
    observed_store_count: int | None


class DatasetAvailability(Contract):
    dataset: Literal["register", "activity", "distribution", "shelf", "typology"]
    first_period: date | None
    last_period: date | None
    months: list[AvailabilityMonth]


class Availability(Contract):
    context: Context
    items: list[DatasetAvailability]
