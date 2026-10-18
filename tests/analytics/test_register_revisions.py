"""Synthetic authoritative source revision and rollback contracts."""

from decimal import Decimal

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests.support.analytics import FEB, JAN, product, register, store


def test_supplement_replaces_the_row_without_summing_or_filling(session: Session) -> None:
    s, p = store(session), product(session)
    monthly = register(session, s, p, revenue=Decimal("10"), units=2)
    monthly.volume_value = Decimal("3")
    revision = register(session, s, p, revenue=Decimal("7"), units=0, kind="supplement")
    row = session.execute(text("SELECT * FROM analytics_register_product_month")).mappings().one()
    assert row["revenue"] == 7 and row["units"] == 0 and row["volume"] is None
    assert row["source_row_count"] == 2 and not row["ambiguous"]
    assert set(row["observation_ids"]) == {monthly.id, revision.id}
    assert row["source_kinds"] == ["monthly", "supplement"]
    assert row["revenue_reported_rows"] == 2
    assert session.execute(text("SELECT revenue FROM analytics_store_month")).scalar_one() == 7
    revision.revenue_value = None
    session.flush()
    assert (
        session.execute(text("SELECT revenue FROM analytics_register_product_month")).scalar_one()
        is None
    )


@pytest.mark.parametrize(
    ("monthly_count", "supplement_count", "ambiguous"),
    [(2, 0, True), (0, 2, True), (1, 2, True), (2, 1, False)],
)
def test_duplicates_within_the_retained_source_remain_ambiguous(
    session: Session, monthly_count: int, supplement_count: int, ambiguous: bool
) -> None:
    s, p = store(session), product(session)
    for _ in range(monthly_count):
        register(session, s, p, revenue=Decimal("10"))
    for _ in range(supplement_count):
        register(session, s, p, revenue=Decimal("7"), kind="supplement")
    row = session.execute(text("SELECT * FROM analytics_register_product_month")).mappings().one()
    assert row["ambiguous"] is ambiguous
    assert row["revenue"] == (None if ambiguous else 7)
    assert (
        row["source_row_count"] == len(row["observation_ids"]) == monthly_count + supplement_count
    )


def test_revision_never_replaces_another_product_or_period(session: Session) -> None:
    s = store(session)
    p, q = product(session), product(session, "1000000000002")
    register(session, s, p, revenue=Decimal("10"))
    register(session, s, p, revenue=Decimal("7"), kind="supplement")
    register(session, s, p, period=FEB, revenue=Decimal("11"))
    register(session, s, q, revenue=Decimal("20"))
    values = session.execute(
        text(
            "SELECT source_gtin,period,revenue FROM analytics_register_product_month "
            "ORDER BY source_gtin,period"
        )
    ).all()
    assert [tuple(row) for row in values] == [
        (p.gtin, JAN, Decimal("7")),
        (p.gtin, FEB, Decimal("11")),
        (q.gtin, JAN, Decimal("20")),
    ]


def test_revision_downgrade_restores_overlap_ambiguity(session: Session) -> None:
    s, p = store(session), product(session)
    register(session, s, p, period=JAN)
    register(session, s, p, period=JAN, revenue=Decimal("7"), kind="supplement")
    assert (
        session.execute(text("SELECT revenue FROM analytics_register_product_month")).scalar_one()
        == 7
    )
    config = Config("alembic.ini")
    config.attributes["connection"] = session.connection()
    command.downgrade(config, "20261017_16")
    assert (
        session.execute(text("SELECT revenue FROM analytics_register_product_month")).scalar_one()
        is None
    )
    command.upgrade(config, "head")
    command.check(config)
    assert (
        session.execute(text("SELECT revenue FROM analytics_register_product_month")).scalar_one()
        == 7
    )


@pytest.mark.parametrize("ratio", [None, Decimal("-1"), Decimal("-0.99"), Decimal("0")])
@pytest.mark.parametrize("kind", ["monthly", "supplement"])
def test_blank_zero_convention_is_measure_specific_and_preserves_raw_evidence(
    session: Session, ratio: Decimal | None, kind: str
) -> None:
    s, p = store(session), product(session)
    observation = register(session, s, p, revenue=None, units=None, kind=kind)
    observation.revenue_change_ratio = ratio
    observation.units_change_ratio = Decimal("-1")
    observation.volume_change_ratio = Decimal("-1")
    session.flush()
    row = session.execute(text("SELECT * FROM analytics_register_product_month")).mappings().one()
    assert row["revenue"] == (0 if kind == "monthly" and ratio == -1 else None)
    assert row["units"] == (0 if kind == "monthly" else None)
    assert row["volume"] is None
    assert row["revenue_reported_rows"] == row["units_reported_rows"] == 0
    assert row["observation_ids"] == [observation.id]
    assert observation.revenue_value is None and observation.units_sold is None
    assert (
        session.execute(text("SELECT revenue_value FROM register_observations")).scalar_one()
        is None
    )


def test_zero_convention_keeps_reported_values_and_reverses_on_downgrade(session: Session) -> None:
    s, p = store(session), product(session)
    observation = register(session, s, p, revenue=Decimal("-2"), units=3)
    observation.revenue_change_ratio = observation.units_change_ratio = Decimal("-1")
    session.flush()
    row = session.execute(text("SELECT revenue,units FROM analytics_register_product_month")).one()
    assert tuple(row) == (Decimal("-2"), 3)
    observation.revenue_value = None
    session.flush()
    assert session.execute(text("SELECT revenue FROM analytics_store_month")).scalar_one() == 0
    config = Config("alembic.ini")
    config.attributes["connection"] = session.connection()
    command.downgrade(config, "20261017_16")
    assert session.execute(text("SELECT revenue FROM analytics_store_month")).scalar_one() is None
    command.upgrade(config, "head")
    command.check(config)
    assert session.execute(text("SELECT revenue FROM analytics_store_month")).scalar_one() == 0
