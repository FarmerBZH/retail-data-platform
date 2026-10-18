"""Synthetic regressions for provenance and historical label reconciliation."""

import uuid

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.orm import Session

from retail_data_platform.database.models import TypologyMappingRule, TypologyRankRule
from tests.support.analytics import distribution, product, rank_assortment, store, typology


@pytest.mark.parametrize(
    ("observations", "expected", "ambiguous"),
    [
        ([(1, "reported"), (0, "inferred_absence")], 1, False),
        ([(0, "inferred_absence"), (0, "inferred_absence")], 0, False),
        ([(1, "reported"), (1, "reported")], 1, False),
        ([(0, "reported"), (1, "reported")], None, True),
        ([(0, "reported"), (0, "inferred_absence")], 0, False),
        ([(0, "inferred_absence")], 0, False),
    ],
)
def test_presence_uses_reported_evidence_without_losing_provenance(
    session: Session, observations: list[tuple[int, str]], expected: int | None, ambiguous: bool
) -> None:
    s, p = store(session), product(session)
    for value, origin in observations:
        distribution(session, s, p, value, origin=origin)
    row = (
        session.execute(text("SELECT * FROM analytics_distribution_product_month")).mappings().one()
    )
    assert row["presence_value"] == expected
    assert row["ambiguous"] is ambiguous
    assert row["source_row_count"] == len(observations) == len(set(row["observation_ids"]))
    assert row["inferred_absence_rows"] == sum(o == "inferred_absence" for _, o in observations)
    category = (
        session.execute(text("SELECT * FROM analytics_store_category_month")).mappings().one()
    )
    assert category["present_products"] == expected
    assert category["distribution_ambiguous_products"] == int(ambiguous)


@pytest.mark.parametrize(
    "bad_target,valid", [("Synthetic retailer", True), ("Other", False), (None, True), ("", True)]
)
def test_retailer_alias_validity_is_checked_at_retailer_grain(
    session: Session, bad_target: str | None, valid: bool
) -> None:
    s, p = store(session), product(session)
    typology(session, s)
    a = rank_assortment(session, p)
    a.source_retailer_name = "Source retailer"
    a.typology_match_status = "unsegmented"
    a.typology_rank_rule_id = None
    a.typology_match_method = None
    a.source_typology_value = None
    for index, (target, error) in enumerate([("Synthetic retailer", False), (bad_target, True)]):
        session.add(
            TypologyMappingRule(
                id=uuid.uuid4(),
                source_key=uuid.uuid4().hex * 2,
                raw_retailer_name="Source retailer",
                raw_category_name=f"Category {index}",
                raw_typology_value="T1",
                mapped_retailer_name=target,
                mapped_category_code="CAT-A",
                mapped_typology_value="T1",
                has_source_error=error,
            )
        )
    session.flush()
    rows = (
        session.execute(text("SELECT assortment_id FROM analytics_retailer_assortment_month"))
        .scalars()
        .all()
    )
    assert rows == ([a.id] if valid else [])
    # A retailer-level alias is context only, never category eligibility.
    assert (
        session.execute(text("SELECT count(*) FROM analytics_assortment_candidates")).scalar_one()
        == 0
    )


def test_normalized_rank_match_keeps_collisions_explicit(session: Session) -> None:
    s, p = store(session), product(session)
    v = typology(session, s, "Gamme étoilée")
    a = rank_assortment(session, p, "Gamme Etoilee")
    row = session.execute(text("SELECT * FROM analytics_typology_month")).mappings().one()
    assert row["rank_rule_ids"] == [a.typology_rank_rule_id]
    assert (
        session.execute(text("SELECT count(*) FROM analytics_assortment_candidates")).scalar_one()
        == 1
    )
    rank = session.get(TypologyRankRule, a.typology_rank_rule_id)
    assert rank is not None
    session.add(
        TypologyRankRule(
            id=uuid.uuid4(),
            retailer_name=rank.retailer_name,
            category_name=rank.category_name,
            category_code=rank.category_code,
            rank=2,
            typology_value="Gamme-Étoilée",
        )
    )
    session.flush()
    row = session.execute(text("SELECT * FROM analytics_typology_month")).mappings().one()
    assert row["typology_value_id"] == v.id and row["rank_candidate_count"] == 2
    assert (
        session.execute(text("SELECT count(*) FROM analytics_assortment_candidates")).scalar_one()
        == 0
    )


def test_normalized_invalid_mapping_still_blocks_direct_rank(session: Session) -> None:
    s, p = store(session), product(session)
    typology(session, s, "Élite")
    rank_assortment(session, p, "Elite")
    session.add(
        TypologyMappingRule(
            id=uuid.uuid4(),
            source_key=uuid.uuid4().hex * 2,
            raw_retailer_name="SYNTHETIC-RETAILER",
            raw_category_name="Sýnthetic category",
            raw_typology_value="ELITE",
            has_source_error=True,
        )
    )
    session.flush()
    row = session.execute(text("SELECT * FROM analytics_typology_month")).mappings().one()
    assert row["rank_candidate_count"] == 1 and row["mapping_issue"]
    assert (
        session.execute(text("SELECT count(*) FROM analytics_assortment_candidates")).scalar_one()
        == 0
    )


def test_downgrade_restores_previous_presence_semantics(session: Session) -> None:
    s, p = store(session), product(session)
    distribution(session, s, p, 1)
    distribution(session, s, p, 0)
    config = Config("alembic.ini")
    config.attributes["connection"] = session.connection()
    assert (
        session.execute(
            text("SELECT presence_value FROM analytics_distribution_product_month")
        ).scalar_one()
        == 1
    )
    command.downgrade(config, "20261015_15")
    assert (
        session.execute(
            text("SELECT presence_value FROM analytics_distribution_product_month")
        ).scalar_one()
        is None
    )
    command.upgrade(config, "head")
    command.check(config)
    assert (
        session.execute(
            text("SELECT presence_value FROM analytics_distribution_product_month")
        ).scalar_one()
        == 1
    )
