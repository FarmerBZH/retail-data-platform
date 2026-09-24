import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from shutil import copytree

import pytest

from retail_data_platform.importers.shelf_share import (
    ShelfShareDataset,
    ShelfShareSourceError,
    StoreIdentity,
    read_shelf_share_dataset,
)

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "shelf_share_sources"
CATEGORY_CODES = {"category-a": "CAT-A", "category-b": "CAT-B", "category-c": "CAT-C"}


def store_identities() -> list[StoreIdentity]:
    return [
        StoreIdentity(
            uuid.UUID(int=1),
            None,
            "CRM-100",
            "ERP-100",
            None,
            None,
            None,
            "Synthetic Store A",
            "Synthetic Store A LLC",
        ),
        StoreIdentity(
            uuid.UUID(int=2),
            None,
            None,
            "ERP-200",
            None,
            None,
            None,
            "Synthetic Store B",
            "Synthetic Store B LLC",
        ),
        StoreIdentity(
            uuid.UUID(int=3),
            None,
            None,
            "ERP-300",
            None,
            None,
            None,
            "Synthetic Store C",
            "Synthetic Store C LLC",
        ),
    ]


def read_dataset(source_root: Path = FIXTURE_ROOT) -> ShelfShareDataset:
    return read_shelf_share_dataset(
        source_root, source_root / "aliases.csv", store_identities(), CATEGORY_CODES
    )


def copy_sources(tmp_path: Path) -> Path:
    return copytree(FIXTURE_ROOT, tmp_path / "shelf_share_sources")


def test_aggregates_duplicates_and_preserves_zero_denominators() -> None:
    dataset = read_dataset()
    records = {record.source_store_reference: record for record in dataset.records}

    assert dataset.rows_read == 6
    assert len(dataset.records) == 5
    assert dataset.duplicate_rows == 1
    assert sum(record.source_row_count for record in dataset.records) == dataset.rows_read
    assert {record.period for record in dataset.records} == {date(2025, 1, 1)}
    assert records["CRM-100"].company_value == Decimal("4.00")
    assert records["CRM-100"].total_value == Decimal("15.00")
    assert records["CRM-100"].share == Decimal("0.26666667")
    assert records["CRM-100"].source_row_count == 2
    assert records["ALIAS-S2"].share is None
    assert records["ALIAS-S2"].store_id == uuid.UUID(int=2)
    assert records["ALIAS-S2"].store_match_method == "alias"
    assert records["UNKNOWN"].store_match_status == "unresolved"
    assert records["Synthetic Store B"].store_match_method == "name"


def test_generates_stable_identifiers() -> None:
    first = read_dataset().records
    second = read_dataset().records
    assert [(record.id, record.source_key) for record in first] == [
        (record.id, record.source_key) for record in second
    ]


def test_rejects_bad_measure_without_echoing_value(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    path = sources / "category-b" / "202501_share.xls"
    path.write_text(path.read_text().replace("7,25", "PRIVATE"), encoding="utf-8")

    with pytest.raises(ShelfShareSourceError) as captured:
        read_dataset(sources)
    assert "invalid company value" in str(captured.value)
    assert "PRIVATE" not in str(captured.value)


def test_rejects_mismatched_month_coverage(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    path = sources / "category-a" / "202502_share.xls"
    path.write_text((sources / "category-a" / "202501_share.xls").read_text())

    with pytest.raises(ShelfShareSourceError, match="do not cover the same months"):
        read_dataset(sources)


def test_rejects_conflicting_store_identity(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    stores = store_identities()
    stores.append(
        StoreIdentity(
            uuid.UUID(int=4), None, "CRM-100", None, None, None, None, "Synthetic Store D", None
        )
    )

    dataset = read_shelf_share_dataset(sources, sources / "aliases.csv", stores, CATEGORY_CODES)
    record = next(row for row in dataset.records if row.source_store_reference == "CRM-100")
    assert record.store_id is None
    assert record.store_match_status == "conflict"
