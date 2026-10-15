"""Bounded analytical reads over the published snapshot, with no HTTP dependency.

The caller owns a single read-only repeatable-read transaction. This module never
opens connections, changes isolation, refreshes data, or reads the live store master.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from functools import cached_property
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import BigInteger, Connection, Numeric, and_, case, cast, func, literal, or_, select

from retail_data_platform.database.analytics import StoreDatasetMonth, StoreMonth, StoreScope

MEASURES = ("revenue", "units", "calls", "field_visits", "crowdsourced_visits")
DIMENSIONS = {"retailer_name": 128, "region_code": 32, "store_format": 64}
DATASETS = ("register", "activity", "distribution", "shelf", "typology")


class AnalysisInputError(ValueError):
    """Stable, value-free domain validation error."""


@dataclass(frozen=True, repr=False)
class Scope:
    mode: Literal["all", "selection"] = "all"
    store_ids: tuple[UUID, ...] = ()
    retailer_name: str | None = None
    region_code: str | None = None
    store_format: str | None = None
    activity_status: Literal["all", "active", "inactive"] = "all"

    def __post_init__(self) -> None:
        if (
            self.mode not in ("all", "selection")
            or self.activity_status not in ("all", "active", "inactive")
            or not isinstance(self.store_ids, tuple)
            or len(self.store_ids) > 100
            or any(not isinstance(value, UUID) for value in self.store_ids)
            or len(set(self.store_ids)) != len(self.store_ids)
            or (self.mode == "all" and bool(self.store_ids))
            or (self.mode == "selection" and not self.store_ids)
        ):
            raise AnalysisInputError("invalid_scope")
        for field, maximum in DIMENSIONS.items():
            value = getattr(self, field)
            if value is not None and (not isinstance(value, str) or len(value) > maximum):
                raise AnalysisInputError("invalid_filter")

    def statement(self) -> Any:
        table = StoreScope.__table__
        query = select(table)
        if self.mode == "selection":
            query = query.where(table.c.store_id.in_(self.store_ids))
        for field in DIMENSIONS:
            value = getattr(self, field)
            if value is not None:
                query = query.where(table.c[field] == value)
        if self.activity_status != "all":
            query = query.where(table.c.is_active.is_(self.activity_status == "active"))
        return query


def _month_index(value: date) -> int:
    if type(value) is not date or value.day != 1:
        raise AnalysisInputError("invalid_month")
    return value.year * 12 + value.month - 1


def _shift(value: date, months: int) -> date:
    index = _month_index(value) + months
    if index < 12 or index > 9999 * 12 + 11:
        raise AnalysisInputError("invalid_reference_window")
    return date(index // 12, index % 12 + 1, 1)


@dataclass(frozen=True)
class Window:
    start: date
    end: date

    def __post_init__(self) -> None:
        if not 1 <= _month_index(self.end) - _month_index(self.start) + 1 <= 120:
            raise AnalysisInputError("invalid_window")

    @property
    def months(self) -> int:
        return _month_index(self.end) - _month_index(self.start) + 1

    def reference(self, mode: Literal["previous", "previous_year"]) -> Window:
        if mode not in ("previous", "previous_year"):
            raise AnalysisInputError("invalid_comparison")
        offset = -self.months if mode == "previous" else -12
        return Window(_shift(self.start, offset), _shift(self.end, offset))


@dataclass(frozen=True, repr=False)
class RankKey:
    value: Decimal | None
    store_id: UUID

    def __post_init__(self) -> None:
        if not isinstance(self.store_id, UUID):
            raise AnalysisInputError("invalid_rank_key")
        value = self.value
        if value is not None and (
            not isinstance(value, Decimal)
            or not value.is_finite()
            or len(value.as_tuple().digits) > 1024
            or abs(value.adjusted()) > 512
        ):
            raise AnalysisInputError("invalid_rank_key")


def _page(limit: int, maximum: int = 200) -> None:
    if type(limit) is not int or not 1 <= limit <= maximum:
        raise AnalysisInputError("invalid_limit")


def _search(column: Any, query: str) -> Any:
    escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return column.ilike("%" + escaped + "%", escape="\\")


def _query(query: str | None) -> None:
    if query is not None and (not isinstance(query, str) or not 1 <= len(query) <= 128):
        raise AnalysisInputError("invalid_search")


def _complete(value: Any, covered: Any, expected: Any) -> Any:
    return case((and_(expected > 0, covered == expected), value))


def _comparison(current: Any, reference: Any, prefix: str) -> list[Any]:
    return [
        (current - reference).label(prefix + "_change"),
        ((current - reference) / func.nullif(reference, 0)).label(prefix + "_change_ratio"),
        case(
            (reference.is_(None), "missing"),
            (reference == 0, "zero"),
            (reference < 0, "negative"),
            else_="positive",
        ).label(prefix + "_reference_state"),
    ]


class AnalysisReader:
    """Use one reader per resolved request, inside the caller's snapshot transaction."""

    def __init__(
        self,
        connection: Connection,
        scope: Scope,
        window: Window | None = None,
        comparison: Literal["previous", "previous_year"] = "previous",
    ) -> None:
        self.connection = connection
        self.scope = scope
        if comparison not in ("previous", "previous_year"):
            raise AnalysisInputError("invalid_comparison")
        self._window = window
        self._reference = window.reference(comparison) if window is not None else None
        self.stores = scope.statement().cte("scope_stores")
        master = StoreScope.__table__
        resolved = connection.scalar(
            select(func.count())
            .select_from(master)
            .where(
                master.c.store_id.in_(scope.store_ids)
                if scope.mode == "selection"
                else literal(True)
            )
        )
        if scope.mode == "selection" and resolved != len(scope.store_ids):
            raise AnalysisInputError("unknown_store")
        selected = connection.scalar(select(func.count()).select_from(self.stores))
        assert resolved is not None and selected is not None
        self.counts = {
            "requested_store_count": len(scope.store_ids) if scope.mode == "selection" else None,
            "resolved_store_count": resolved,
            "filtered_out_store_count": resolved - selected,
            "scope_store_count": selected,
        }
        self.store_count = selected

    @property
    def window(self) -> Window:
        if self._window is None:
            raise AnalysisInputError("analysis_window_required")
        return self._window

    @property
    def reference(self) -> Window:
        if self._reference is None:
            raise AnalysisInputError("analysis_window_required")
        return self._reference

    @cached_property
    def per_store(self) -> Any:
        return self._per_store()

    def _per_store(self) -> Any:
        monthly = StoreMonth.__table__
        current = monthly.c.period.between(self.window.start, self.window.end)
        reference = monthly.c.period.between(self.reference.start, self.reference.end)
        fields: list[Any] = [self.stores.c.store_id]
        for prefix, condition in (("current", current), ("reference", reference)):
            fields.append(
                func.count(monthly.c.store_id).filter(condition).label(prefix + "_published_months")
            )
            for metric in MEASURES:
                value = cast(monthly.c[metric], Numeric)
                covered = func.count(value).filter(condition)
                partial = func.sum(value).filter(condition)
                name = prefix + "_" + metric
                fields.extend(
                    [
                        covered.label(name + "_covered"),
                        partial.label(name + "_partial"),
                        _complete(partial, covered, literal(self.window.months)).label(name),
                    ]
                )
            fields.append(
                func.coalesce(
                    func.bool_or(monthly.c.register_ambiguous_products > 0).filter(condition), False
                ).label(prefix + "_revenue_ambiguous")
            )
        return (
            select(*fields)
            .select_from(
                self.stores.outerjoin(
                    monthly,
                    and_(self.stores.c.store_id == monthly.c.store_id, or_(current, reference)),
                )
            )
            .group_by(self.stores.c.store_id)
            .cte("store_windows")
        )

    def _eligible(self, metric: str) -> Any:
        return and_(
            self.per_store.c["current_" + metric].is_not(None),
            self.per_store.c["reference_" + metric].is_not(None),
        )

    def summary_statement(self) -> Any:
        stores = self.per_store
        expected = literal(self.store_count * self.window.months)
        fields: list[Any] = [expected.label("expected_cell_count")]
        full: dict[str, Any] = {}
        for metric in MEASURES:
            for prefix in ("current", "reference"):
                key = prefix + "_" + metric
                covered = cast(func.coalesce(func.sum(stores.c[key + "_covered"]), 0), BigInteger)
                partial = func.sum(stores.c[key + "_partial"])
                full[key] = _complete(partial, covered, expected)
                fields.extend(
                    [
                        full[key].label(key),
                        partial.label(key + "_partial"),
                        covered.label(key + "_covered_cell_count"),
                    ]
                )
            fields.extend(
                _comparison(full["current_" + metric], full["reference_" + metric], metric)
            )
            eligible = self._eligible(metric)
            included = func.count().filter(eligible)
            current = func.sum(stores.c["current_" + metric]).filter(eligible)
            reference = func.sum(stores.c["reference_" + metric]).filter(eligible)
            prefix = "cohort_" + metric
            fields.extend(
                [
                    included.label(prefix + "_store_count"),
                    (literal(self.store_count) - included).label(prefix + "_excluded_store_count"),
                    (included * self.window.months).label(prefix + "_expected_cell_count"),
                    current.label(prefix + "_current"),
                    reference.label(prefix + "_reference"),
                    *_comparison(current, reference, prefix),
                ]
            )
        for prefix in ("current", "reference"):
            fields.append(
                (full[prefix + "_revenue"] / func.nullif(full[prefix + "_units"], 0)).label(
                    prefix + "_revenue_per_unit"
                )
            )
        common = and_(self._eligible("revenue"), self._eligible("units"))
        fields.append(func.count().filter(common).label("unit_revenue_cohort_store_count"))
        for prefix in ("current", "reference"):
            fields.append(
                (
                    func.sum(stores.c[prefix + "_revenue"]).filter(common)
                    / func.nullif(func.sum(stores.c[prefix + "_units"]).filter(common), 0)
                ).label("cohort_" + prefix + "_revenue_per_unit")
            )
        fields.append(
            func.sum(stores.c.current_revenue - stores.c.reference_revenue)
            .filter(self._eligible("revenue"))
            .label("revenue_contribution_sum")
        )
        return select(*fields).select_from(stores)

    def summary(self) -> dict[str, Any]:
        return {
            **self.counts,
            **dict(self.connection.execute(self.summary_statement()).mappings().one()),
        }

    def stores_page(
        self, *, query: str | None = None, after: UUID | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        _page(limit)
        _query(query)
        if after is not None and not isinstance(after, UUID):
            raise AnalysisInputError("invalid_store_key")
        statement = select(self.stores)
        if query is not None:
            statement = statement.where(
                or_(_search(self.stores.c.name, query), _search(self.stores.c.city, query))
            )
        if after is not None:
            statement = statement.where(self.stores.c.store_id > after)
        return self._rows(statement.order_by(self.stores.c.store_id).limit(limit + 1))

    def dimensions_page(
        self, field: str, *, query: str | None = None, after: str | None = None, limit: int = 50
    ) -> list[dict[str, Any]]:
        _page(limit)
        _query(query)
        if field not in DIMENSIONS:
            raise AnalysisInputError("invalid_dimension")
        if after is not None and (not isinstance(after, str) or len(after) > DIMENSIONS[field]):
            raise AnalysisInputError("invalid_dimension_key")
        value = self.stores.c[field]
        statement = select(value.label("value")).where(value.is_not(None)).distinct()
        if query is not None:
            statement = statement.where(_search(value, query))
        if after is not None:
            statement = statement.where(value > after)
        return self._rows(statement.order_by(value).limit(limit + 1))

    def dimension_missing_count(self, field: str) -> int:
        if field not in DIMENSIONS:
            raise AnalysisInputError("invalid_dimension")
        result = self.connection.scalar(
            select(func.count()).select_from(self.stores).where(self.stores.c[field].is_(None))
        )
        assert result is not None
        return int(result)

    def availability(self) -> list[dict[str, Any]]:
        """Sparse observed months; the caller may display missing months without inventing zeros."""
        data = StoreDatasetMonth.__table__
        statement = (
            select(
                data.c.dataset,
                data.c.period,
                cast(func.sum(data.c.source_row_count), BigInteger).label("source_row_count"),
                cast(func.sum(data.c.observed_row_count), BigInteger).label("observed_row_count"),
                cast(func.sum(data.c.inferred_absence_row_count), BigInteger).label(
                    "inferred_absence_row_count"
                ),
                func.count().filter(data.c.observed_row_count > 0).label("observed_store_count"),
            )
            .select_from(data.join(self.stores, data.c.store_id == self.stores.c.store_id))
            .where(data.c.period.between(self.window.start, self.window.end))
            .group_by(data.c.dataset, data.c.period)
            .order_by(data.c.dataset, data.c.period)
        )
        return self._rows(statement)

    def availability_bounds(self) -> list[dict[str, Any]]:
        data = StoreDatasetMonth.__table__
        return self._rows(
            select(
                data.c.dataset,
                func.min(data.c.period).label("first_period"),
                func.max(data.c.period).label("last_period"),
            )
            .select_from(data.join(self.stores, data.c.store_id == self.stores.c.store_id))
            .where(data.c.observed_row_count > 0)
            .group_by(data.c.dataset)
            .order_by(data.c.dataset)
        )

    def ranking_statement(
        self,
        *,
        sort: Literal["revenue", "revenue_change"] = "revenue",
        direction: Literal["asc", "desc"] = "desc",
        after: RankKey | None = None,
        limit: int = 50,
    ) -> Any:
        _page(limit)
        if sort not in ("revenue", "revenue_change") or direction not in ("asc", "desc"):
            raise AnalysisInputError("invalid_sort")
        if after is not None and not isinstance(after, RankKey):
            raise AnalysisInputError("invalid_rank_key")
        windows = self.per_store
        eligible = self._eligible("revenue")
        contribution = case((eligible, windows.c.current_revenue - windows.c.reference_revenue))
        measure = windows.c.current_revenue if sort == "revenue" else contribution
        ordering = [
            (measure.asc() if direction == "asc" else measure.desc()).nulls_last(),
            windows.c.store_id.asc(),
        ]
        ranked = select(
            self.stores,
            windows.c.current_revenue,
            windows.c.reference_revenue,
            windows.c.current_revenue_partial,
            windows.c.reference_revenue_partial,
            windows.c.current_revenue_covered,
            windows.c.reference_revenue_covered,
            literal(self.window.months).label("expected_month_count"),
            contribution.label("revenue_change"),
            measure.label("sort_value"),
            func.row_number().over(order_by=ordering).label("rank"),
            case(
                (eligible, None),
                (
                    or_(
                        windows.c.current_published_months < self.window.months,
                        windows.c.reference_published_months < self.window.months,
                    ),
                    "missing_month",
                ),
                (
                    or_(windows.c.current_revenue_ambiguous, windows.c.reference_revenue_ambiguous),
                    "ambiguous_measure",
                ),
                else_="missing_measure",
            ).label("exclusion_reason"),
        ).select_from(self.stores.join(windows, self.stores.c.store_id == windows.c.store_id))
        rows = ranked.cte("ranked_stores")
        query = select(rows)
        if after is not None:
            if after.value is None:
                predicate = and_(rows.c.sort_value.is_(None), rows.c.store_id > after.store_id)
            else:
                predicate = or_(
                    rows.c.sort_value.is_(None),
                    rows.c.sort_value > after.value
                    if direction == "asc"
                    else rows.c.sort_value < after.value,
                    and_(rows.c.sort_value == after.value, rows.c.store_id > after.store_id),
                )
            query = query.where(predicate)
        value_order = rows.c.sort_value.asc() if direction == "asc" else rows.c.sort_value.desc()
        return query.order_by(value_order.nulls_last(), rows.c.store_id).limit(limit + 1)

    def ranking(
        self,
        *,
        sort: Literal["revenue", "revenue_change"] = "revenue",
        direction: Literal["asc", "desc"] = "desc",
        after: RankKey | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        return self._rows(
            self.ranking_statement(sort=sort, direction=direction, after=after, limit=limit)
        )

    def series(self) -> list[dict[str, Any]]:
        """At most 120 points; cohorts are determined over both complete windows."""
        return self._series_rows(self.stores)

    def store_series(self, *, after: UUID | None = None, limit: int = 6) -> list[dict[str, Any]]:
        """At most six stores per page; no row from the following store is downloaded."""
        _page(limit, 6)
        if after is not None and not isinstance(after, UUID):
            raise AnalysisInputError("invalid_store_key")
        selected = select(self.stores)
        if after is not None:
            selected = selected.where(self.stores.c.store_id > after)
        page = selected.order_by(self.stores.c.store_id).limit(limit).cte("series_stores")
        return self._series_rows(page, individual=True)

    def _series_rows(self, stores: Any, *, individual: bool = False) -> list[dict[str, Any]]:
        # A bounded VALUES calendar avoids timezone shifts and retains out-of-calendar months.
        from sqlalchemy import Date, column, values

        calendar = (
            values(column("period", Date), column("reference_period", Date))
            .data(
                [
                    (_shift(self.window.start, i), _shift(self.reference.start, i))
                    for i in range(self.window.months)
                ]
            )
            .cte("requested_months")
        )
        current = StoreMonth.__table__.alias("current_month")
        reference = StoreMonth.__table__.alias("reference_month")
        windows = self.per_store
        joined = (
            stores.join(windows, stores.c.store_id == windows.c.store_id)
            .join(calendar, literal(True))
            .outerjoin(
                current,
                and_(
                    current.c.store_id == stores.c.store_id, current.c.period == calendar.c.period
                ),
            )
            .outerjoin(
                reference,
                and_(
                    reference.c.store_id == stores.c.store_id,
                    reference.c.period == calendar.c.reference_period,
                ),
            )
        )
        fields: list[Any] = [calendar.c.period, calendar.c.reference_period]
        groups = [calendar.c.period, calendar.c.reference_period]
        if individual:
            fields.append(stores.c.store_id)
            groups.append(stores.c.store_id)
        expected = func.count(stores.c.store_id)
        fields.append(expected.label("expected_cell_count"))
        for metric in MEASURES:
            eligible = self._eligible(metric)
            fields.append(func.count().filter(eligible).label("cohort_" + metric + "_store_count"))
            for prefix, table in (("current", current), ("reference", reference)):
                value = cast(table.c[metric], Numeric)
                covered = func.count(value)
                partial = func.sum(value)
                key = prefix + "_" + metric
                fields.extend(
                    [
                        _complete(partial, covered, expected).label(key),
                        partial.label(key + "_partial"),
                        covered.label(key + "_covered_cell_count"),
                        func.sum(value).filter(eligible).label("cohort_" + key),
                    ]
                )
        statement = select(*fields).select_from(joined).group_by(*groups)
        ordering = [stores.c.store_id, calendar.c.period] if individual else [calendar.c.period]
        return self._rows(statement.order_by(*ordering))

    def _rows(self, statement: Any) -> list[dict[str, Any]]:
        return [dict(row) for row in self.connection.execute(statement).mappings()]
