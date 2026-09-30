"""Synthetic PostgreSQL integration tests. Set TEST_DATABASE_URL to enable."""

from __future__ import annotations

import os
import uuid
from collections.abc import Iterator
from datetime import date
from decimal import Decimal
from typing import Any

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Connection, create_engine, event, inspect, select, text
from sqlalchemy.orm import ORMExecuteState, Session

from retail_data_platform.analytics import _refresh_views
from retail_data_platform.database.analytics import AnalyticsBase, StoreMonth
from retail_data_platform.database.models import (
    Assortment,
    NumericDistributionObservation,
    Product,
    RegisterObservation,
    ShelfShareObservation,
    Store,
    StoreActivityMetric,
    StoreTypologyValue,
    TypologyMappingRule,
    TypologyRankRule,
    TypologySnapshot,
)

JAN = date(2025, 1, 1)
FEB = date(2025, 2, 1)
MAR = date(2025, 3, 1)


@pytest.fixture(scope="module")
def migrated_connection() -> Iterator[Connection]:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is required for isolated PostgreSQL integration tests")
    engine = create_engine(url)
    schema = "test_analytics_" + uuid.uuid4().hex
    with engine.connect() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        connection.execute(text(f'SET LOCAL search_path TO "{schema}"'))
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20260927_13")
        assert "analytics_network_month" not in inspect(connection).get_materialized_view_names()
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20260927_12")
        assert not connection.execute(
            text(
                "SELECT ispopulated FROM pg_matviews WHERE schemaname=current_schema() "
                "AND matviewname='analytics_retailer_assortment_month'"
            )
        ).scalar_one()
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20260926_11")
        assert not inspect(connection).get_materialized_view_names()
        assert len(inspect(connection).get_view_names()) == 11
        command.upgrade(config, "head")
        command.check(config)
        command.downgrade(config, "20260925_10")
        assert not inspect(connection).get_view_names()
        assert not inspect(connection).get_materialized_view_names()
        command.upgrade(config, "head")
        command.check(config)
        try:
            yield connection
        finally:
            # All test data, DDL and schema creation are in the outer transaction.
            connection.rollback()
    engine.dispose()


@pytest.fixture
def session(migrated_connection: Connection) -> Iterator[Session]:
    with Session(migrated_connection, join_transaction_mode="create_savepoint") as session:
        # These tests assert measure semantics after publication. Refresh the
        # synthetic snapshot before each analytical SELECT. Lifecycle/staleness
        # tests use ordinary sessions in test_analytics_refresh instead.
        @event.listens_for(session, "do_orm_execute")
        def refresh_before_read(state: ORMExecuteState) -> None:
            if state.is_select or str(state.statement).lstrip().upper().startswith("SELECT"):
                session.flush()
                _refresh_views(session.connection())

        yield session
        session.rollback()


def store(session: Session, suffix: str = "one") -> Store:
    result = Store(id=uuid.uuid4(), source_key=f"synthetic-{suffix}", name=f"Synthetic {suffix}")
    session.add(result)
    session.flush()
    return result


def product(session: Session, gtin: str = "1000000000001") -> Product:
    result = Product(id=uuid.uuid4(), gtin=gtin, internal_code=gtin, name="Synthetic product")
    session.add(result)
    session.flush()
    return result


def register(
    session: Session,
    s: Store | None,
    p: Product,
    period: date = JAN,
    revenue: Decimal | None = Decimal("10"),
    units: int | None = 2,
    kind: str = "monthly",
) -> RegisterObservation:
    result = RegisterObservation(
        id=uuid.uuid4(),
        period=period,
        source_kind=kind,
        source_store_reference="synthetic-reference",
        store_id=s.id if s else None,
        store_match_status="matched" if s else "unresolved",
        store_match_method="synthetic" if s else None,
        source_gtin=p.gtin,
        product_id=p.id,
        product_match_status="matched",
        revenue_value=revenue,
        units_sold=units,
    )
    session.add(result)
    session.flush()
    return result


def activity(session: Session, s: Store, count: int, kind: str = "calls") -> None:
    session.add(
        StoreActivityMetric(
            id=uuid.uuid4(),
            source_key=uuid.uuid4().hex.ljust(64, "0"),
            period=JAN,
            store_id=s.id,
            store_match_status="matched",
            store_match_method="synthetic",
            activity_type=kind,
            activity_count=count,
            source_store_reference="synthetic",
            source_store_label="Synthetic store",
        )
    )
    session.flush()


def distribution(
    session: Session,
    s: Store,
    p: Product,
    presence: int,
    category: str = "CAT-A",
) -> None:
    session.add(
        NumericDistributionObservation(
            id=uuid.uuid4(),
            source_key=uuid.uuid4().hex.ljust(64, "0"),
            period=JAN,
            category_code=category,
            store_id=s.id,
            store_match_status="matched",
            store_match_method="synthetic",
            product_id=p.id,
            product_match_status="matched",
            product_match_method="synthetic",
            presence_value=presence,
            value_origin="reported" if presence else "inferred_absence",
            source_category_name="Synthetic category",
            source_store_reference="synthetic",
            source_store_label="Synthetic store",
            source_product_reference=p.gtin,
            source_product_label="Synthetic product",
        )
    )
    session.flush()


def shelf(session: Session, s: Store, company: int, total: int, category: str) -> None:
    session.add(
        ShelfShareObservation(
            id=uuid.uuid4(),
            source_key=uuid.uuid4().hex.ljust(64, "0"),
            period=JAN,
            category_code=category,
            store_id=s.id,
            store_match_status="matched",
            store_match_method="synthetic",
            company_value=company,
            total_value=total,
            share=Decimal(company) / total if total else None,
            source_row_count=1,
            source_category_name="Synthetic category",
            source_store_reference="synthetic",
            source_store_label="Synthetic store",
        )
    )
    session.flush()


def monthly(session: Session, s: Store, period: date = JAN) -> Any:
    return session.execute(
        select(StoreMonth).where(StoreMonth.store_id == s.id, StoreMonth.period == period)
    ).scalar_one()


def test_empty_and_view_model_contract(session: Session) -> None:
    assert session.scalars(select(StoreMonth)).all() == []
    inspector = inspect(session.connection())
    assert set(inspector.get_materialized_view_names()) == set(AnalyticsBase.metadata.tables)
    for table in AnalyticsBase.metadata.tables.values():
        actual = inspector.get_columns(table.name)
        assert {c["name"] for c in actual} == set(table.columns.keys())
        for column in actual:
            expected_type = table.c[column["name"]].type.compile(dialect=session.bind.dialect)  # type: ignore[union-attr]
            actual_type = column["type"].compile(dialect=session.bind.dialect)  # type: ignore[union-attr]
            assert actual_type == expected_type
        session.execute(select(table).limit(1))


def test_dense_calendar_missing_is_not_zero_and_calendar_lags(session: Session) -> None:
    s, empty = store(session), store(session, "empty")
    p = product(session)
    register(session, s, p)
    register(session, s, p, MAR, Decimal("30"))
    activity(session, s, 0)
    rows = session.scalars(
        select(StoreMonth).order_by(StoreMonth.store_id, StoreMonth.period)
    ).all()
    assert len(rows) == 6
    assert monthly(session, s).calls == 0
    assert monthly(session, s).field_visits is None
    assert monthly(session, s, FEB).revenue is None
    assert not monthly(session, empty).has_register
    march = (
        session.execute(
            text("SELECT * FROM analytics_store_month_changes WHERE store_id=:s AND period=:p"),
            {"s": s.id, "p": MAR},
        )
        .mappings()
        .one()
    )
    assert march["revenue_previous_month"] is None
    assert march["revenue_month_change_ratio"] is None
    assert march["revenue_previous_year"] is None


def test_facts_do_not_fan_out_and_shares_remain_by_category(session: Session) -> None:
    s = store(session)
    p, q = product(session), product(session, "1000000000002")
    register(session, s, p)
    register(session, s, q, revenue=Decimal("30"), units=3)
    activity(session, s, 2)
    activity(session, s, 3, "field_visits")
    distribution(session, s, p, 1)
    distribution(session, s, q, 0)
    shelf(session, s, 2, 10, "CAT-A")
    shelf(session, s, 0, 0, "CAT-B")
    row = monthly(session, s)
    assert row.revenue == 40 and row.units == 5 and row.revenue_per_unit == 8
    assert row.calls == 2 and row.field_visits == 3
    assert row.register_source_row_count == 2
    categories = {c["category_code"]: c for c in row.category_details}
    assert categories["CAT-A"]["observed_presence_rate"] == 0.5
    assert categories["CAT-A"]["inferred_absence_rows"] == 1
    assert categories["CAT-A"]["shelf_share"] == 0.2
    assert categories["CAT-B"]["shelf_share"] is None


def test_ambiguous_aliases_and_source_overlap_are_not_summed(session: Session) -> None:
    s, p = store(session), product(session)
    first = register(session, s, p)
    second = register(session, s, p, kind="supplement")
    activity(session, s, 2)
    activity(session, s, 2)
    distribution(session, s, p, 1)
    distribution(session, s, p, 0)
    shelf(session, s, 2, 10, "CAT-A")
    shelf(session, s, 3, 10, "CAT-A")
    row = monthly(session, s)
    assert row.revenue is None and row.units is None
    assert row.register_ambiguous_products == 1 and row.calls is None
    assert row.activity_ambiguous_types == 1
    category = row.category_details[0]
    assert category["distribution_ambiguous_products"] == 1
    assert category["observed_presence_rate"] is None
    assert category["shelf_ambiguous"] and category["shelf_share"] is None
    ids = session.execute(
        text("SELECT observation_ids FROM analytics_register_product_month")
    ).scalar_one()
    assert set(ids) == {first.id, second.id}


def test_missing_measures_partial_sum_and_zero_denominator(session: Session) -> None:
    s = store(session)
    p, q = product(session), product(session, "1000000000002")
    register(session, s, p, revenue=None, units=0)
    register(session, s, q, revenue=Decimal("0"), units=0)
    row = monthly(session, s)
    assert row.revenue is None and row.unambiguous_reported_revenue == 0
    assert row.register_revenue_product_count == 1
    assert row.units == 0 and row.revenue_per_unit is None


def test_orphans_remain_in_quality_not_invented_store(session: Session) -> None:
    s, p = store(session), product(session)
    register(session, None, p)
    assert not monthly(session, s).has_register
    row = (
        session.execute(
            text("SELECT * FROM analytics_monthly_link_quality WHERE dataset='register'")
        )
        .mappings()
        .one()
    )
    assert row["store_match_status"] == "unresolved" and row["source_row_count"] == 1


def typology(
    session: Session, s: Store, value: str = "T1", period: date = JAN
) -> StoreTypologyValue:
    snapshot = TypologySnapshot(
        id=uuid.uuid4(),
        source_key=uuid.uuid4().hex.ljust(64, "0"),
        period=period,
        store_id=s.id,
        store_match_status="matched",
        store_match_method="synthetic",
        retailer_name="Synthetic retailer",
        region_code="Historical region",
    )
    session.add(snapshot)
    session.flush()
    v = StoreTypologyValue(
        id=uuid.uuid4(),
        snapshot_id=snapshot.id,
        category_key="synthetic_category",
        category_name="Synthetic category",
        typology_value=value,
    )
    session.add(v)
    session.flush()
    return v


def rank_assortment(session: Session, p: Product, value: str = "T1", rank: int = 1) -> Assortment:
    r = TypologyRankRule(
        id=uuid.uuid4(),
        retailer_name="Synthetic retailer",
        category_name="Synthetic category",
        category_code="CAT-A",
        rank=rank,
        typology_value=value,
    )
    session.add(r)
    session.flush()
    a = Assortment(
        id=uuid.uuid4(),
        source_key=uuid.uuid4().hex.ljust(64, "0"),
        period=JAN,
        product_id=p.id,
        product_match_status="matched",
        typology_rank_rule_id=r.id,
        typology_match_status="matched",
        typology_match_method="product_category",
        source_retailer_name="Synthetic retailer",
        source_category_name="Synthetic category",
        source_product_name="Synthetic product",
        gtin=p.gtin,
        source_typology_value=value,
    )
    session.add(a)
    session.flush()
    return a


def test_exact_assortment_no_rank_cumulation_no_future_fill(session: Session) -> None:
    s, p = store(session), product(session)
    s.region_code = "Current region"
    typology(session, s)
    # Identical independent snapshots preserve evidence but do not multiply membership.
    typology(session, s)
    exact = rank_assortment(session, p)
    rank_assortment(session, p, "T2", 2)
    register(session, s, p, FEB)
    rows = session.execute(text("SELECT * FROM analytics_assortment_candidates")).mappings().all()
    assert len(rows) == 1 and rows[0]["assortment_id"] == exact.id
    assert len(rows[0]["typology_value_ids"]) == 2
    jan, feb = monthly(session, s), monthly(session, s, FEB)
    assert jan.typology_snapshot_count == 2
    assert jan.current_region_code == "Current region"
    assert jan.typology_details[0]["region_code"] == "Historical region"
    assert feb.typology_details == [] and not feb.has_typology
    assert (
        session.execute(
            text("SELECT count(*) FROM analytics_retailer_assortment_month")
        ).scalar_one()
        == 2
    )


def test_conflicting_typology_cannot_choose_an_assortment(session: Session) -> None:
    s, p = store(session), product(session)
    typology(session, s)
    typology(session, s, "T2")
    rank_assortment(session, p)
    rank_assortment(session, p, "T2", 2)
    assert (
        session.execute(text("SELECT count(*) FROM analytics_assortment_candidates")).scalar_one()
        == 0
    )
    assert len(monthly(session, s).typology_details) == 2


def test_invalid_mapping_cannot_be_hidden_by_direct_rank_match(session: Session) -> None:
    s, p = store(session), product(session)
    typology(session, s)
    rank_assortment(session, p)
    session.add(
        TypologyMappingRule(
            id=uuid.uuid4(),
            source_key=uuid.uuid4().hex.ljust(64, "0"),
            raw_retailer_name="Synthetic retailer",
            raw_category_name="Synthetic category",
            raw_typology_value="T1",
            has_source_error=True,
        )
    )
    session.flush()
    assert session.execute(text("SELECT mapping_issue FROM analytics_typology_month")).scalar_one()
    assert (
        session.execute(text("SELECT count(*) FROM analytics_assortment_candidates")).scalar_one()
        == 0
    )


def test_negative_returns_and_true_year_lag(session: Session) -> None:
    s, p = store(session), product(session)
    register(session, s, p, revenue=Decimal("20"), units=4)
    register(session, s, p, date(2026, 1, 1), Decimal("-5"), -1)
    row = (
        session.execute(
            text("SELECT * FROM analytics_store_month_changes WHERE period=:p"),
            {"p": date(2026, 1, 1)},
        )
        .mappings()
        .one()
    )
    assert row["revenue_previous_year"] == 20
    assert row["revenue_year_change_ratio"] == Decimal("-1.25")
    assert monthly(session, s, date(2026, 1, 1)).revenue_per_unit == 5


def test_explicit_mapping_links_different_labels_and_conflicting_ranks_block(
    session: Session,
) -> None:
    s, p = store(session), product(session)
    value = typology(session, s, "Source tier")
    assortment = rank_assortment(session, p, "Canonical tier")
    value.category_name = "Source category"
    mapping = TypologyMappingRule(
        id=uuid.uuid4(),
        source_key=uuid.uuid4().hex.ljust(64, "0"),
        raw_retailer_name="Synthetic retailer",
        raw_category_name="Source category",
        raw_typology_value="Source tier",
        mapped_retailer_name="Synthetic retailer",
        mapped_category_code="CAT-A",
        mapped_typology_value="Canonical tier",
        has_source_error=False,
    )
    session.add(mapping)
    session.flush()
    assert (
        session.execute(
            text("SELECT assortment_id FROM analytics_assortment_candidates")
        ).scalar_one()
        == assortment.id
    )
    # Two rank IDs with the same semantic value must never choose a winner.
    rank_assortment(session, p, "Canonical tier", 2)
    assert (
        session.execute(
            text("SELECT rank_candidate_count FROM analytics_typology_month")
        ).scalar_one()
        == 2
    )
    assert (
        session.execute(text("SELECT count(*) FROM analytics_assortment_candidates")).scalar_one()
        == 0
    )


def test_unresolved_product_revenue_and_unsegmented_retailer_context(session: Session) -> None:
    s, p = store(session), product(session)
    observation = register(session, s, p)
    observation.product_id = None
    observation.product_match_status = "unresolved"
    typology(session, s)
    session.add(
        Assortment(
            id=uuid.uuid4(),
            source_key=uuid.uuid4().hex.ljust(64, "0"),
            period=JAN,
            product_id=None,
            product_match_status="unresolved",
            typology_match_status="unsegmented",
            source_retailer_name="Synthetic retailer",
            source_category_name="Synthetic category",
            source_product_name="Synthetic product",
            gtin=p.gtin,
            source_typology_value=None,
        )
    )
    session.flush()
    row = monthly(session, s)
    assert row.revenue == 10 and row.register_unmatched_product_rows == 1
    assert (
        session.execute(text("SELECT count(*) FROM analytics_assortment_candidates")).scalar_one()
        == 0
    )
    context = (
        session.execute(text("SELECT * FROM analytics_retailer_assortment_month")).mappings().one()
    )
    assert context["typology_match_status"] == "unsegmented"
    assert context["product_match_status"] == "unresolved"


def test_retailer_context_uses_a_unique_validated_retailer_mapping(session: Session) -> None:
    s, p = store(session), product(session)
    typology(session, s)
    mapping = TypologyMappingRule(
        id=uuid.uuid4(),
        source_key=uuid.uuid4().hex.ljust(64, "0"),
        raw_retailer_name="Source retailer",
        raw_category_name="Source category",
        raw_typology_value="Source tier",
        mapped_retailer_name="Synthetic retailer",
        mapped_category_code="CAT-A",
        mapped_typology_value="T1",
        has_source_error=False,
    )
    session.add(mapping)
    assortment = Assortment(
        id=uuid.uuid4(),
        source_key=uuid.uuid4().hex.ljust(64, "0"),
        period=JAN,
        product_id=p.id,
        product_match_status="matched",
        typology_match_status="unsegmented",
        source_retailer_name="Source retailer",
        source_category_name="Source category",
        source_product_name="Synthetic product",
        gtin=p.gtin,
        source_typology_value=None,
    )
    session.add(assortment)
    session.flush()
    assert (
        session.execute(
            text("SELECT assortment_id FROM analytics_retailer_assortment_month")
        ).scalar_one()
        == assortment.id
    )
    mapping.has_source_error = True
    session.flush()
    assert (
        session.execute(
            text("SELECT count(*) FROM analytics_retailer_assortment_month")
        ).scalar_one()
        == 0
    )


def test_undated_store_alone_has_no_calendar_and_empty_snapshot_is_retained(
    session: Session,
) -> None:
    s = store(session)
    assert session.scalars(select(StoreMonth)).all() == []
    snapshot = TypologySnapshot(
        id=uuid.uuid4(),
        source_key=uuid.uuid4().hex.ljust(64, "0"),
        period=JAN,
        store_id=s.id,
        store_match_status="matched",
        store_match_method="synthetic",
    )
    session.add(snapshot)
    session.flush()
    row = monthly(session, s)
    assert row.has_typology and not row.has_register
    assert row.typology_snapshot_ids == [snapshot.id]
    assert row.typology_details == []
