"""Network contracts verified on isolated, entirely synthetic PostgreSQL data."""

from datetime import date
from decimal import Decimal

import test_store_monthly as monthly
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_store_monthly import (
    FEB,
    JAN,
    MAR,
    activity,
    product,
    register,
    store,
)

from retail_data_platform.database.analytics import (
    NetworkMonth,
    NetworkMonthChanges,
    NetworkOverview,
    NetworkYear,
)

migrated_connection = monthly.migrated_connection
session = monthly.session


def test_empty_network_is_unavailable(session: Session) -> None:
    assert session.scalars(select(NetworkMonth)).all() == []
    overview = session.scalars(select(NetworkOverview)).one()
    assert overview.scope == "network"
    assert overview.expected_cell_count == overview.store_count == overview.month_count == 0
    assert overview.revenue is None and overview.revenue_partial is None
    assert overview.revenue_per_unit is None and overview.first_period is None


def test_coverage_zero_returns_and_independent_activity(session: Session) -> None:
    a, b = store(session, "a"), store(session, "b")
    p = product(session)
    register(session, a, p, JAN, Decimal("100.10"), 2)
    register(session, b, p, JAN, Decimal("0"), 0)
    register(session, a, p, FEB, Decimal("-10.05"), -1)
    activity(session, a, 0)
    activity(session, b, 3)
    activity(session, a, 5, "field_visits")
    months = session.scalars(select(NetworkMonth).order_by(NetworkMonth.period)).all()
    jan, feb = months
    assert jan.expected_cell_count == jan.revenue_covered_cell_count == 2
    assert jan.revenue == jan.revenue_partial == Decimal("100.10")
    assert jan.revenue_per_unit == Decimal("50.05")
    assert jan.calls == 3 and jan.calls_covered_cell_count == 2
    assert jan.field_visits is None and jan.field_visits_partial == 5
    assert feb.revenue is None and feb.revenue_partial == Decimal("-10.05")
    assert feb.revenue_covered_cell_count == 1 and feb.expected_cell_count == 2
    assert feb.revenue_per_unit is None and feb.calls_partial is None
    overview = session.scalars(select(NetworkOverview)).one()
    assert overview.expected_cell_count == 4 and overview.revenue_covered_cell_count == 3
    assert overview.revenue is None and overview.revenue_partial == Decimal("90.05")
    assert overview.store_count == overview.stores_with_register == 2
    assert overview.first_period == JAN and overview.last_period == FEB
    year = session.scalars(select(NetworkYear)).one()
    assert year.period == JAN and year.month_count == 2
    assert year.revenue_partial == overview.revenue_partial


def test_product_ambiguities_do_not_become_sales(session: Session) -> None:
    a = store(session)
    p, q = product(session), product(session, "1000000000002")
    register(session, a, p, revenue=Decimal("9.10"))
    register(session, a, p, revenue=Decimal("9.10"), kind="supplement")
    register(session, a, q, revenue=Decimal("2.20"))
    row = session.scalars(select(NetworkMonth)).one()
    assert row.revenue is None and row.revenue_partial is None
    assert row.unambiguous_reported_revenue == Decimal("2.20")
    assert row.register_product_count == 2 and row.register_ambiguous_products == 1
    assert row.stores_with_register == 1 and row.revenue_covered_cell_count == 0


def test_measure_coverage_is_independent_and_ratio_needs_both(session: Session) -> None:
    a = store(session)
    p = product(session)
    register(session, a, p, revenue=Decimal("4"), units=None)
    row = session.scalars(select(NetworkMonth)).one()
    assert row.revenue == 4 and row.revenue_covered_cell_count == 1
    assert row.units is None and row.units_covered_cell_count == 0
    assert row.revenue_per_unit is None


def test_calendar_gaps_and_outside_coverage(session: Session) -> None:
    a, p = store(session), product(session)
    register(session, a, p, JAN, Decimal("10"))
    register(session, a, p, MAR, Decimal("20"))
    changes = session.scalars(
        select(NetworkMonthChanges).order_by(NetworkMonthChanges.period)
    ).all()
    assert [row.period for row in changes] == [JAN, FEB, MAR]
    assert changes[-1].revenue_previous_month is None
    assert changes[-1].revenue_month_change_ratio is None
    assert (
        session.scalars(select(NetworkMonth).where(NetworkMonth.period == date(2024, 12, 1))).all()
        == []
    )
    overview = session.scalars(select(NetworkOverview)).one()
    assert overview.expected_cell_count == 3 and overview.revenue is None


def test_zero_negative_and_year_comparison_bases(session: Session) -> None:
    a, p = store(session), product(session)
    register(session, a, p, JAN, Decimal("0"), 0)
    register(session, a, p, FEB, Decimal("-10"))
    register(session, a, p, MAR, Decimal("5"))
    register(session, a, p, date(2026, 2, 1), Decimal("20"))
    rows = {row.period: row for row in session.scalars(select(NetworkMonthChanges))}
    assert rows[FEB].revenue_month_change == -10
    assert rows[FEB].revenue_month_change_ratio is None
    assert rows[MAR].revenue_month_change == 15
    assert rows[MAR].revenue_month_change_ratio == Decimal("-1.5")
    assert rows[date(2026, 2, 1)].revenue_previous_year == -10
    assert rows[date(2026, 2, 1)].revenue_year_change == 30
    assert rows[date(2026, 2, 1)].revenue_year_change_ratio == -3
    years = session.scalars(select(NetworkYear).order_by(NetworkYear.period)).all()
    assert len(years) == 2 and years[0].month_count == 12 and years[1].month_count == 2


def test_unattributed_observations_are_not_network_sales(session: Session) -> None:
    store(session)
    p = product(session)
    register(session, None, p, revenue=Decimal("999"))
    row = session.scalars(select(NetworkMonth)).one()
    assert row.expected_cell_count == 1 and row.stores_with_register == 0
    assert row.revenue_partial is None and row.unambiguous_reported_revenue is None
