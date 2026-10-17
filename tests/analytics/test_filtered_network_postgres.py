"""Exact filtered analytics on transactional, entirely synthetic PostgreSQL data."""

from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Connection, select
from sqlalchemy.orm import Session

from retail_data_platform.analytics import _refresh_views
from retail_data_platform.api.resources import RESOURCES
from retail_data_platform.database.analytics import (
    InternalAnalyticsBase,
    StoreDatasetMonth,
    StoreScope,
)
from retail_data_platform.database.models import Product, Store, StoreTypologyValue
from retail_data_platform.database.network_analysis import (
    AnalysisInputError,
    AnalysisReader,
    RankKey,
    Scope,
    Window,
)
from tests.support.analytics import (
    FEB,
    JAN,
    MAR,
    activity,
    distribution,
    product,
    register,
    shelf,
    store,
    typology,
)

DEC = date(2024, 12, 1)


@pytest.fixture
def data(migrated_connection: Connection) -> Iterator[Session]:
    with Session(migrated_connection, join_transaction_mode="create_savepoint") as session:
        yield session
        session.rollback()


def publish(session: Session) -> None:
    session.flush()
    _refresh_views(session.connection())


def read(
    session: Session, scope: Scope | None = None, start: date = FEB, end: date = FEB
) -> AnalysisReader:
    return AnalysisReader(session.connection(), scope or Scope(), Window(start, end))


def seed_pair(session: Session) -> tuple[Store, Store]:
    a, b = store(session, "a"), store(session, "b")
    p = product(session)
    register(session, a, p, JAN, Decimal("100"), 2)
    register(session, b, p, JAN, Decimal("200"), 4)
    register(session, a, p, FEB, Decimal("120"), 3)
    publish(session)
    return a, b


def test_internal_snapshots_are_not_http_resources(data: Session) -> None:
    store(data)
    publish(data)
    assert len(RESOURCES) == 28
    assert set(InternalAnalyticsBase.metadata.tables).isdisjoint(RESOURCES)
    assert data.scalar(select(StoreScope.name)) == "Synthetic one"
    assert data.scalars(select(StoreDatasetMonth)).all() == []
    summary = read(data).summary()
    assert summary["scope_store_count"] == 1
    assert summary["expected_cell_count"] == 1
    assert summary["current_revenue"] is None
    assert summary["current_revenue_partial"] is None


def test_missing_vs_zero_common_oracle_and_contributions(data: Session) -> None:
    a, b = seed_pair(data)
    summary = read(data).summary()
    assert summary["current_revenue"] is None
    assert summary["current_revenue_partial"] == Decimal("120")
    assert summary["current_revenue_covered_cell_count"] == 1
    assert summary["expected_cell_count"] == 2
    assert summary["reference_revenue"] == 300
    assert summary["revenue_change"] is None
    assert summary["cohort_revenue_store_count"] == 1
    assert summary["cohort_revenue_excluded_store_count"] == 1
    assert summary["cohort_revenue_current"] == 120
    assert summary["cohort_revenue_reference"] == 100
    assert summary["cohort_revenue_change"] == summary["revenue_contribution_sum"] == 20
    assert summary["cohort_revenue_change_ratio"] == Decimal("0.2")
    ranking = read(data).ranking(sort="revenue_change")
    assert ranking[0]["store_id"] == a.id and ranking[0]["revenue_change"] == 20
    assert ranking[1]["store_id"] == b.id and ranking[1]["exclusion_reason"] == "missing_measure"
    p = data.scalar(select(Product))
    assert p is not None
    register(data, b, p, FEB, Decimal("0"), 0)
    publish(data)
    summary = read(data).summary()
    assert summary["current_revenue"] == 120
    assert summary["cohort_revenue_store_count"] == 2
    assert summary["cohort_revenue_change"] == summary["revenue_change"] == -180
    assert summary["revenue_contribution_sum"] == -180
    assert summary["revenue_change_ratio"] == Decimal("-0.6")
    assert [r["revenue_change"] for r in read(data).ranking(sort="revenue_change")] == [20, -200]


def test_window_grid_includes_out_of_calendar_months(data: Session) -> None:
    s, p = store(data), product(data)
    register(data, s, p, JAN, Decimal("10"))
    register(data, s, p, MAR, Decimal("20"))
    publish(data)
    analysis = read(data, start=JAN, end=date(2025, 4, 1))
    result = analysis.summary()
    assert result["expected_cell_count"] == 4
    assert result["current_revenue_covered_cell_count"] == 2
    assert result["current_revenue_partial"] == 30 and result["current_revenue"] is None
    series = analysis.series()
    assert [row["period"] for row in series] == [JAN, FEB, MAR, date(2025, 4, 1)]
    assert [row["current_revenue"] for row in series] == [10, None, 20, None]
    assert all(row["expected_cell_count"] == 1 for row in series)
    assert all(row["cohort_revenue_store_count"] == 0 for row in series)
    assert (
        read(data, start=date(2030, 1, 1), end=date(2030, 1, 1)).ranking()[0]["exclusion_reason"]
        == "missing_month"
    )


def test_cohort_is_fixed_across_whole_windows_and_independent_by_measure(data: Session) -> None:
    a, b = store(data, "a"), store(data, "b")
    p = product(data)
    for s in (a, b):
        for month in (date(2024, 11, 1), DEC, JAN, FEB):
            register(data, s, p, month, Decimal("1"), None if s == b and month == FEB else 1)
    activity(data, b, 0)
    publish(data)
    analysis = read(data, start=JAN, end=FEB)
    summary = analysis.summary()
    assert summary["cohort_revenue_store_count"] == 2
    assert summary["cohort_units_store_count"] == summary["unit_revenue_cohort_store_count"] == 1
    assert summary["cohort_current_revenue_per_unit"] == 1
    assert summary["current_revenue_per_unit"] is None
    assert summary["current_calls_partial"] == 0
    assert summary["cohort_calls_store_count"] == 0
    points = analysis.series()
    assert [row["cohort_units_store_count"] for row in points] == [1, 1]
    assert [row["cohort_current_units"] for row in points] == [1, 1]
    assert [row["current_units_covered_cell_count"] for row in points] == [2, 1]


def test_no_join_multiplication_and_exact_small_decimals(data: Session) -> None:
    a, b = store(data, "a"), store(data, "b")
    p, q = product(data), product(data, "1000000000002")
    register(data, a, p, JAN, Decimal("0.1"))
    register(data, a, q, JAN, Decimal("0.2"))
    register(data, b, p, JAN, Decimal("0"))
    for category in ("CAT-A", "CAT-B"):
        distribution(data, a, p, 1, category)
        shelf(data, a, 1, 2, category)
    publish(data)
    summary = read(data, start=JAN, end=JAN).summary()
    assert summary["current_revenue"] == Decimal("0.3")
    assert summary["current_revenue_covered_cell_count"] == 2
    assert isinstance(summary["current_revenue_covered_cell_count"], int)
    assert isinstance(summary["current_revenue"], Decimal)
    assert summary["revenue_change_ratio"] is None


def test_zero_negative_and_year_reference(data: Session) -> None:
    s, p = store(data), product(data)
    for month, amount, units in [(JAN, "0", 0), (FEB, "-10", -1), (MAR, "5", 1)]:
        register(data, s, p, month, Decimal(amount), units)
    register(data, s, p, date(2026, 2, 1), Decimal("20"), 2)
    publish(data)
    result = read(data).summary()
    assert result["revenue_change"] == -10
    assert result["revenue_change_ratio"] is None and result["revenue_reference_state"] == "zero"
    assert result["reference_revenue_per_unit"] is None
    result = read(data, start=MAR, end=MAR).summary()
    assert result["revenue_change"] == 15 and result["revenue_change_ratio"] == Decimal("-1.5")
    assert result["revenue_reference_state"] == "negative"
    yearly = AnalysisReader(
        data.connection(), Scope(), Window(date(2026, 2, 1), date(2026, 2, 1)), "previous_year"
    )
    assert yearly.summary()["revenue_change"] == 30
    assert yearly.series()[0]["reference_period"] == FEB


def test_selection_identity_intersection_and_empty_scope(data: Session) -> None:
    a, b = seed_pair(data)
    a.region_code, b.region_code = "R-A", "R-B"
    b.is_active = False
    publish(data)
    summary = read(data, Scope("selection", (a.id, b.id), region_code="R-A")).summary()
    assert {
        key: summary[key]
        for key in (
            "requested_store_count",
            "resolved_store_count",
            "filtered_out_store_count",
            "scope_store_count",
        )
    } == {
        "requested_store_count": 2,
        "resolved_store_count": 2,
        "filtered_out_store_count": 1,
        "scope_store_count": 1,
    }
    assert summary["current_revenue"] == 120
    assert read(data, Scope(activity_status="inactive")).summary()["scope_store_count"] == 1
    empty = read(data, Scope(region_code="no match"))
    assert empty.summary()["expected_cell_count"] == 0
    assert empty.summary()["current_revenue_partial"] is None
    assert empty.ranking() == empty.series() == []
    with pytest.raises(AnalysisInputError, match="unknown_store"):
        read(data, Scope("selection", (a.id, uuid4())))


def test_frozen_dimensions_and_observations_do_not_follow_live_sources(data: Session) -> None:
    a, _ = seed_pair(data)
    a.name, a.region_code = "Changed master", "Later"
    p = product(data, "1000000000003")
    register(data, a, p, MAR, Decimal("999"))
    data.flush()
    assert read(data).stores_page()[0]["name"] != "Changed master"
    assert read(data, Scope(region_code="Later")).summary()["scope_store_count"] == 0
    assert read(data, start=MAR, end=MAR).availability() == []
    publish(data)
    assert read(data, Scope("selection", (a.id,))).stores_page()[0]["name"] == "Changed master"
    assert read(data, Scope(region_code="Later")).summary()["scope_store_count"] == 1
    assert read(data, start=MAR, end=MAR).availability()[0]["observed_row_count"] == 1


def test_availability_counts_reported_and_inferred_and_snapshot_not_children(data: Session) -> None:
    s, p = store(data), product(data)
    register(data, s, p)
    register(data, None, p, revenue=Decimal("999"))
    activity(data, s, 0)
    activity(data, s, 0)  # Ambiguous activity is still observed.
    distribution(data, s, p, 1)
    distribution(data, s, p, 0, "CAT-B")
    shelf(data, s, 1, 2, "CAT-A")
    value = typology(data, s, period=date(2025, 1, 15))
    data.add(
        StoreTypologyValue(
            id=uuid4(),
            snapshot_id=value.snapshot_id,
            category_key="second",
            category_name="Second category",
            typology_value="synthetic",
        )
    )
    publish(data)
    reader = read(data, start=JAN, end=JAN)
    counts = {row["dataset"]: row for row in reader.availability()}
    assert set(counts) == {"register", "activity", "distribution", "shelf", "typology"}
    assert counts["register"]["source_row_count"] == 1
    assert counts["activity"]["observed_row_count"] == 2
    assert reader.summary()["current_calls"] is None
    assert counts["typology"]["source_row_count"] == 1
    assert counts["distribution"]["observed_row_count"] == 1
    assert counts["distribution"]["inferred_absence_row_count"] == 1
    assert counts["distribution"]["source_row_count"] == 2
    assert all(
        row["first_period"] == JAN == row["last_period"] for row in reader.availability_bounds()
    )


def test_inferred_absence_alone_does_not_define_observed_bounds(data: Session) -> None:
    s, p = store(data), product(data)
    distribution(data, s, p, 0)
    publish(data)
    reader = read(data, start=JAN, end=JAN)
    assert reader.availability()[0]["observed_store_count"] == 0
    assert reader.availability_bounds() == []


@pytest.mark.parametrize("direction", ["asc", "desc"])
@pytest.mark.parametrize("sort", ["revenue", "revenue_change"])
def test_ranking_global_order_ties_nulls_and_keyset_pages(
    data: Session, direction: Any, sort: Any
) -> None:
    p = product(data)
    for i, amount in enumerate(["0", "120", "120", "-10", None, "300"]):
        s = Store(id=UUID(int=i + 1), source_key=f"synthetic-{i}", name=f"Synthetic {i}")
        data.add(s)
        data.flush()
        register(data, s, p, JAN, Decimal("100"))
        if amount is not None:
            register(data, s, p, FEB, Decimal(amount))
    publish(data)
    reader = read(data)
    expected = [4, 1, 2, 3, 6, 5] if direction == "asc" else [6, 2, 3, 1, 4, 5]
    one = reader.ranking(sort=sort, direction=direction, limit=2)
    assert len(one) == 3  # One bounded lookahead; the HTTP adapter owns the cursor envelope.
    result = one[:2]
    while len(result) < 6:
        last = result[-1]
        page = reader.ranking(
            sort=sort,
            direction=direction,
            after=RankKey(last["sort_value"], last["store_id"]),
            limit=2,
        )
        result.extend(page[:2])
    assert [row["store_id"].int for row in result] == expected
    assert [row["rank"] for row in result] == [1, 2, 3, 4, 5, 6]
    assert result[-1]["exclusion_reason"] == "missing_measure"
    assert reader.ranking(sort=sort, direction=direction, after=RankKey(None, UUID(int=5))) == []


def test_seven_store_series_pages_keep_whole_selection_totals(data: Session) -> None:
    p = product(data)
    for i in range(7):
        s = Store(id=UUID(int=i + 1), source_key=f"synthetic-{i}", name=f"Synthetic {i}")
        data.add(s)
        data.flush()
        register(data, s, p, JAN, Decimal("1"))
        register(data, s, p, FEB, Decimal("2"))
    publish(data)
    reader = read(data)
    first = reader.store_series()
    second = reader.store_series(after=first[-1]["store_id"])
    assert len(first) == 6 and len(second) == 1
    assert {r["store_id"] for r in first}.isdisjoint({second[0]["store_id"]})
    assert reader.summary()["current_revenue"] == 14
    assert reader.summary()["cohort_revenue_change"] == 7


def test_literal_search_and_exact_filters_cannot_be_sql(data: Session) -> None:
    a, b = store(data, "a"), store(data, "b")
    a.name = "Literal %_ and \\ name"
    a.city, a.retailer_name, a.region_code, a.store_format = "City", "Brand", "R", "Small"
    b.name = "Ordinary"
    publish(data)
    reader = read(data)
    assert [r["store_id"] for r in reader.stores_page(query="%_")] == [a.id]
    assert [r["store_id"] for r in reader.stores_page(query="CITY")] == [a.id]
    assert reader.stores_page(query="' OR 1=1 --") == []
    assert read(data, Scope(retailer_name="' OR 1=1 --")).stores_page() == []
    assert reader.dimensions_page("retailer_name") == [{"value": "Brand"}]
    assert reader.dimension_missing_count("retailer_name") == 1
    with pytest.raises(AnalysisInputError, match="invalid_dimension"):
        reader.dimensions_page("name; DROP TABLE stores")
    with pytest.raises(AnalysisInputError, match="invalid_sort"):
        reader.ranking(sort="private")  # type: ignore[arg-type]
    with pytest.raises(AnalysisInputError, match="invalid_limit"):
        reader.store_series(limit=7)


def test_product_ambiguity_has_explicit_exclusion(data: Session) -> None:
    s, p = store(data), product(data)
    register(data, s, p, JAN)
    register(data, s, p, FEB)
    register(data, s, p, FEB, kind="supplement")
    publish(data)
    assert read(data).ranking()[0]["exclusion_reason"] == "ambiguous_measure"
    assert read(data).summary()["cohort_revenue_store_count"] == 0


def test_activity_can_be_complete_without_sales(data: Session) -> None:
    s = store(data)
    activity(data, s, 0)
    publish(data)
    summary = read(data, start=JAN, end=JAN).summary()
    assert summary["current_calls"] == 0
    assert summary["current_calls_covered_cell_count"] == 1
    assert summary["current_revenue"] is None
    assert summary["current_revenue_partial"] is None
    assert summary["current_revenue_covered_cell_count"] == 0


def test_search_and_dimension_pagination_are_bounded(data: Session) -> None:
    for i in range(4):
        s = Store(
            id=UUID(int=i + 1), source_key=f"page-{i}", name=f"Page {i}", retailer_name=f"Brand {i}"
        )
        data.add(s)
    publish(data)
    reader = read(data)
    stores = reader.stores_page(limit=1)
    assert len(stores) == 2
    assert reader.stores_page(after=stores[0]["store_id"], limit=1)[0]["store_id"] == UUID(int=2)
    assert reader.dimensions_page("retailer_name", limit=1) == [
        {"value": "Brand 0"},
        {"value": "Brand 1"},
    ]
    assert reader.dimensions_page("retailer_name", after="Brand 1", limit=1) == [
        {"value": "Brand 2"},
        {"value": "Brand 3"},
    ]
    assert reader.dimensions_page("retailer_name", query="Brand 0") == [{"value": "Brand 0"}]


def test_overlapping_year_reference_counts_each_window_independently(data: Session) -> None:
    s, p = store(data), product(data)
    # Both windows include January 2025; it must not be lost or joined twice within a window.
    register(data, s, p, JAN, Decimal("10"))
    publish(data)
    reader = AnalysisReader(
        data.connection(), Scope(), Window(JAN, date(2026, 1, 1)), "previous_year"
    )
    result = reader.summary()
    assert result["expected_cell_count"] == 13
    assert result["current_revenue_partial"] == result["reference_revenue_partial"] == 10
    assert result["current_revenue_covered_cell_count"] == 1
    assert result["reference_revenue_covered_cell_count"] == 1


def test_empty_calendar_and_no_stores_is_an_unavailable_measure(data: Session) -> None:
    publish(data)
    reader = read(data)
    result = reader.summary()
    assert result["scope_store_count"] == 0
    assert result["current_revenue"] is result["current_revenue_partial"] is None
    assert result["expected_cell_count"] == 0
    assert result["cohort_revenue_store_count"] == 0
    assert reader.series() == reader.store_series() == reader.availability() == []


def test_synthetic_query_profile_has_bounded_output(data: Session) -> None:
    """Measured fixture, not a production load test or a machine-dependent latency gate."""
    import json

    from sqlalchemy import insert

    from retail_data_platform.database.models import RegisterObservation

    stores = [UUID(int=i + 1000) for i in range(300)]
    data.execute(
        insert(Store),
        [
            {
                "id": sid,
                "source_key": f"profile-{i}",
                "name": f"Synthetic profile {i}",
                "retailer_name": f"Brand {i % 3}",
                "region_code": f"R-{i % 4}",
                "is_active": i % 5 != 0,
            }
            for i, sid in enumerate(stores)
        ],
    )
    p = product(data)
    data.execute(
        insert(RegisterObservation),
        [
            {
                "id": uuid4(),
                "period": date(2024 + month // 12, month % 12 + 1, 1),
                "source_kind": "monthly",
                "source_store_reference": "synthetic profile",
                "store_id": sid,
                "store_match_status": "matched",
                "store_match_method": "synthetic",
                "source_gtin": p.gtin,
                "product_id": p.id,
                "product_match_status": "matched",
                "revenue_value": Decimal("1"),
                "units_sold": 1,
            }
            for sid in stores
            for month in range(24)
        ],
    )
    publish(data)
    reader = read(data, start=JAN, end=FEB)
    assert reader.summary()["current_revenue"] == 600
    assert len(reader.series()) == 2
    assert len(reader.ranking(limit=5)) == 6
    assert len(reader.store_series(limit=6)) == 12
    selective = read(data, Scope(retailer_name="Brand 0", region_code="R-0"), JAN, FEB)
    assert selective.summary()["scope_store_count"] == 25
    profiles = []
    for name, instance, query in [
        ("summary_all", reader, reader.summary_statement()),
        ("summary_filtered", selective, selective.summary_statement()),
        ("ranking_all", reader, reader.ranking_statement(limit=5)),
    ]:
        compiled = query.compile(
            dialect=data.connection().dialect, compile_kwargs={"render_postcompile": True}
        )
        plan = (
            data.connection()
            .exec_driver_sql(
                "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + str(compiled), compiled.params
            )
            .scalar_one()[0]
        )
        profiles.append(
            {
                "query": name,
                "stores": instance.store_count,
                "execution_ms": plan["Execution Time"],
                "planning_ms": plan["Planning Time"],
                "result_rows": plan["Plan"]["Actual Rows"],
            }
        )
    print("SYNTHETIC_ANALYTICS_PROFILE " + json.dumps(profiles))


def test_discovery_does_not_require_an_analysis_window(data: Session) -> None:
    seed_pair(data)
    reader = AnalysisReader(data.connection(), Scope())
    assert len(reader.stores_page()) == 2
    assert reader.dimension_missing_count("region_code") == 2
    assert reader.dimensions_page("region_code") == []
    assert reader.availability_bounds() == [
        {
            "dataset": "register",
            "first_period": JAN,
            "last_period": FEB,
        }
    ]
    for calculation in (
        reader.summary,
        reader.series,
        reader.ranking,
        reader.availability,
        reader.store_series,
    ):
        with pytest.raises(AnalysisInputError, match="analysis_window_required"):
            calculation()
