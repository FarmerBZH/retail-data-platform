import uuid
from pathlib import Path
from shutil import copytree

import pytest

from retail_data_platform.importers.assortments import (
    AssortmentDataset,
    AssortmentSourceError,
    MappingIdentity,
    ProductIdentity,
    RankIdentity,
    read_assortment_dataset,
)

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "assortment_sources"


def product_identities() -> list[ProductIdentity]:
    return [
        ProductIdentity(uuid.UUID(int=1), "1234567890123", "CAT-A"),
        ProductIdentity(uuid.UUID(int=2), "1234567890124", "CAT-A"),
    ]


def mapping_identities() -> list[MappingIdentity]:
    return [
        MappingIdentity(
            uuid.UUID(int=3),
            "Example Retail",
            "Category A",
            "Tier 1",
            "Canonical Retail",
            "CAT-A",
            "T1",
            False,
        )
    ]


def rank_identities() -> list[RankIdentity]:
    return [RankIdentity(uuid.UUID(int=4), "Canonical Retail", "CAT-A", "T1")]


def copy_sources(tmp_path: Path) -> Path:
    return copytree(FIXTURE_ROOT, tmp_path / "assortment_sources")


def read_dataset(source_directory: Path = FIXTURE_ROOT) -> AssortmentDataset:
    return read_assortment_dataset(
        source_directory,
        product_identities(),
        mapping_identities(),
        rank_identities(),
    )


def test_reads_normalized_assortment_dataset() -> None:
    dataset = read_dataset()

    assert dataset.rows_read == 3
    assert [record.product_match_status for record in dataset.records] == [
        "matched",
        "matched",
        "unresolved",
    ]
    assert [record.typology_match_status for record in dataset.records] == [
        "matched",
        "unsegmented",
        "unmapped",
    ]
    assert dataset.records[0].typology_rank_rule_id == uuid.UUID(int=4)
    assert dataset.records[0].typology_match_method == "mapping_rule"
    assert dataset.records[1].source_typology_value is None


def test_generates_stable_record_identifiers() -> None:
    first = read_dataset()
    second = read_dataset()

    assert [record.id for record in first.records] == [record.id for record in second.records]


def test_consolidates_equivalent_mapping_rules() -> None:
    duplicate = MappingIdentity(
        uuid.UUID(int=5),
        "Example Retail",
        "Category A",
        "Tier 1",
        "Canonical Retail",
        "CAT-A",
        "T1",
        False,
    )

    dataset = read_assortment_dataset(
        FIXTURE_ROOT,
        product_identities(),
        [*mapping_identities(), duplicate],
        rank_identities(),
    )

    assert dataset.records[0].typology_match_status == "matched"
    assert dataset.records[0].typology_mapping_rule_id is None
    assert dataset.records[0].typology_rank_rule_id == uuid.UUID(int=4)


def test_marks_semantically_different_mapping_rules_as_conflict() -> None:
    conflicting = MappingIdentity(
        uuid.UUID(int=5),
        "Example Retail",
        "Category A",
        "Tier 1",
        "Canonical Retail",
        "CAT-B",
        "T1",
        False,
    )

    dataset = read_assortment_dataset(
        FIXTURE_ROOT,
        product_identities(),
        [*mapping_identities(), conflicting],
        rank_identities(),
    )

    assert dataset.records[0].typology_match_status == "mapping_conflict"
    assert dataset.records[0].typology_mapping_rule_id is None


def test_uses_product_category_when_mapping_category_has_no_rank() -> None:
    category_variant = MappingIdentity(
        uuid.UUID(int=3),
        "Example Retail",
        "Category A",
        "Tier 1",
        "Canonical Retail",
        "SOURCE-CAT-A",
        "T1",
        False,
    )

    dataset = read_assortment_dataset(
        FIXTURE_ROOT,
        product_identities(),
        [category_variant],
        rank_identities(),
    )

    assert dataset.records[0].typology_match_status == "matched"
    assert dataset.records[0].typology_match_method == "product_category"
    assert dataset.records[0].typology_rank_rule_id == uuid.UUID(int=4)


def test_preserves_mapping_source_errors() -> None:
    source_error = MappingIdentity(
        uuid.UUID(int=3),
        "Example Retail",
        "Category A",
        "Tier 1",
        "Canonical Retail",
        "CAT-A",
        "T1",
        True,
    )

    dataset = read_assortment_dataset(
        FIXTURE_ROOT,
        product_identities(),
        [source_error],
        rank_identities(),
    )

    assert dataset.records[0].typology_match_status == "mapping_source_error"
    assert dataset.records[0].typology_mapping_rule_id == uuid.UUID(int=3)
    assert dataset.records[0].typology_rank_rule_id is None


def test_rejects_duplicate_month_partition(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    (sources / "202501_duplicate.csv").write_text(
        (sources / "202501_assortments.csv").read_text(),
        encoding="utf-8",
    )

    with pytest.raises(AssortmentSourceError, match="More than one assortment file"):
        read_dataset(sources)


def test_rejects_duplicate_source_identity(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "202501_assortments.csv"
    lines = source.read_text().splitlines()
    source.write_text("\n".join([*lines, lines[1]]) + "\n", encoding="utf-8")

    with pytest.raises(AssortmentSourceError, match="source identity is duplicated"):
        read_dataset(sources)


def test_rejects_unexpected_contract(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "202501_assortments.csv"
    source.write_text(source.read_text().replace("Nom strate", "Unknown", 1), encoding="utf-8")

    with pytest.raises(AssortmentSourceError, match="unexpected contract"):
        read_dataset(sources)


def test_rejects_invalid_product_code_without_echoing_it(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "202501_assortments.csv"
    source.write_text(source.read_text().replace("1234567890123", "PRIVATE"), encoding="utf-8")

    with pytest.raises(AssortmentSourceError) as captured:
        read_dataset(sources)

    assert "invalid product code" in str(captured.value)
    assert "PRIVATE" not in str(captured.value)
