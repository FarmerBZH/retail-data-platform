import uuid
from pathlib import Path
from shutil import copytree

import pytest

from retail_data_platform.importers.typologies import (
    StoreIdentity,
    TypologySourceError,
    read_typology_dataset,
)

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "typology_sources"
MONTHLY_DIRECTORY = FIXTURE_ROOT / "3_typologies"


def store_identities() -> list[StoreIdentity]:
    return [
        StoreIdentity(uuid.UUID(int=1), "NET-001", "CRM-001", "1001", None, "700001", None),
        StoreIdentity(uuid.UUID(int=2), "NET-002", "CRM-002", "1002", None, "700002", None),
    ]


def copy_sources(tmp_path: Path) -> Path:
    root = copytree(FIXTURE_ROOT, tmp_path / "typology_sources")
    return root / "3_typologies"


def test_reads_normalized_typology_dataset() -> None:
    dataset = read_typology_dataset(MONTHLY_DIRECTORY, store_identities())

    assert len(dataset.snapshots) == 3
    assert len(dataset.values) == 4
    assert len(dataset.rank_rules) == 2
    assert len(dataset.mapping_rules) == 1
    assert dataset.rows_read == 7
    assert [record.store_match_status for record in dataset.snapshots] == [
        "matched",
        "matched",
        "unresolved",
    ]
    assert dataset.snapshots[1].store_match_method == "alias"
    assert dataset.values[0].category_key == "boissons_a_infuser"


def test_generates_stable_record_identifiers() -> None:
    first = read_typology_dataset(MONTHLY_DIRECTORY, store_identities())
    second = read_typology_dataset(MONTHLY_DIRECTORY, store_identities())

    assert [record.id for record in first.snapshots] == [record.id for record in second.snapshots]
    assert [record.id for record in first.values] == [record.id for record in second.values]


def test_marks_conflicting_store_identifiers(tmp_path: Path) -> None:
    monthly = copy_sources(tmp_path)
    source = monthly / "202501_typologies.csv"
    source.write_text(
        source.read_text().replace("POS-1|NET-001", "POS-1|NET-002"), encoding="utf-8"
    )

    dataset = read_typology_dataset(monthly, store_identities())

    assert dataset.snapshots[0].store_id is None
    assert dataset.snapshots[0].store_match_status == "conflict"


def test_rejects_duplicate_month_partition(tmp_path: Path) -> None:
    monthly = copy_sources(tmp_path)
    (monthly / "202501_duplicate.csv").write_text(
        (monthly / "202501_typologies.csv").read_text(), encoding="utf-8"
    )

    with pytest.raises(TypologySourceError, match="More than one typology file"):
        read_typology_dataset(monthly, store_identities())


def test_rejects_duplicate_source_identity(tmp_path: Path) -> None:
    monthly = copy_sources(tmp_path)
    source = monthly / "202501_typologies.csv"
    lines = source.read_text().splitlines()
    source.write_text("\n".join([*lines, lines[1]]) + "\n", encoding="utf-8")

    with pytest.raises(TypologySourceError, match="source identity is duplicated"):
        read_typology_dataset(monthly, store_identities())


def test_rejects_unexpected_monthly_contract(tmp_path: Path) -> None:
    monthly = copy_sources(tmp_path)
    source = monthly / "202501_typologies.csv"
    source.write_text(source.read_text().replace("TDLINX", "UNKNOWN", 1), encoding="utf-8")

    with pytest.raises(TypologySourceError, match="unexpected contract"):
        read_typology_dataset(monthly, store_identities())
