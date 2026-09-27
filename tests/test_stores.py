from decimal import Decimal
from pathlib import Path
from shutil import copytree

import pytest

from retail_data_platform.importers.stores import (
    StoreSourceError,
    StoreSourceValidationError,
    read_store_records,
)

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "store_sources"


def copy_sources(tmp_path: Path) -> Path:
    return copytree(FIXTURE_DIRECTORY, tmp_path / "store_sources")


def test_reads_and_merges_store_sources() -> None:
    records = read_store_records(FIXTURE_DIRECTORY)

    assert len(records) == 3
    assert records[0].crm_code == "CRM-001"
    assert records[0].annual_turnover_2025_millions == Decimal("12.50")
    assert records[0].annual_turnover_2024_millions == Decimal("11.50")
    assert records[0].annual_turnover_2023_millions == Decimal("10.50")
    assert records[0].october_2023_turnover_millions == Decimal("10.25")
    assert records[0].sales_area_sqm == 2500
    assert records[0].has_direct_sales_potential is True


def test_keeps_unmatched_historical_store_as_partial_record() -> None:
    record = read_store_records(FIXTURE_DIRECTORY)[2]

    assert record.source_key == "retail_panel:700003"
    assert record.retail_panel_code == "700003"
    assert record.crm_code is None
    assert record.name is None
    assert record.october_2023_turnover_millions == Decimal("6.50")


def test_rejects_identity_conflict_between_sources(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "annual_turnover.csv"
    source.write_text(
        source.read_text().replace("Sample Central", "Different Name"), encoding="utf-8"
    )

    with pytest.raises(StoreSourceError, match="identity fields disagree"):
        read_store_records(sources)


def test_rejects_ambiguous_historical_panel_code(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    for name in ("listing.csv", "annual_turnover.csv"):
        source = sources / name
        source.write_text(
            source.read_text().replace("700002,Sample North", "700001,Sample North"),
            encoding="utf-8",
        )

    with pytest.raises(StoreSourceError, match="more than one store"):
        read_store_records(sources)


def test_rejects_duplicate_historical_panel_code(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "historical_turnover.csv"
    lines = source.read_text().splitlines()
    source.write_text("\n".join([*lines, lines[1]]) + "\n", encoding="utf-8")

    with pytest.raises(StoreSourceValidationError, match="is duplicated"):
        read_store_records(sources)


def test_rejects_invalid_number_without_exposing_value(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "listing.csv"
    source.write_text(source.read_text().replace(",2500,Gold", ",secret,Gold"), encoding="utf-8")

    with pytest.raises(StoreSourceValidationError) as captured:
        read_store_records(sources)

    assert "surface_de_vente_m2: must be a non-negative integer" in str(captured.value)
    assert "secret" not in str(captured.value)


def test_rejects_unexpected_source_contract(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    (sources / "unexpected.csv").write_text("unknown,columns\n1,2\n", encoding="utf-8")

    with pytest.raises(StoreSourceError, match="supported store source contract"):
        read_store_records(sources)
