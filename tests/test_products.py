from decimal import Decimal
from pathlib import Path
from shutil import copytree

import pytest

from retail_data_platform.importers.products import (
    ProductSourceError,
    ProductSourceValidationError,
    is_valid_gtin,
    read_product_records,
)

FIXTURE_DIRECTORY = Path(__file__).parent / "fixtures" / "product_sources"


def copy_sources(tmp_path: Path) -> Path:
    return copytree(FIXTURE_DIRECTORY, tmp_path / "product_sources")


def test_reads_synthetic_product_catalog() -> None:
    records = read_product_records(FIXTURE_DIRECTORY)

    assert len(records) == 3
    assert records[0].gtin == "9990000000012"
    assert records[0].erp_code == "2001"
    assert records[0].legacy_erp_code == "1001"
    assert records[0].internal_code == "CURRENT-001"
    assert records[0].legacy_internal_code == "DEMO-001"
    assert records[0].name == "Updated Lotion"
    assert records[0].content_quantity == Decimal("250")
    assert records[0].average_price == Decimal("12.50")
    assert records[0].average_price_currency == "EUR"
    assert records[2].brand is None
    assert records[2].category_code is None


def test_removes_zero_width_space_before_gtin_validation(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "catalog.csv"
    source.write_text(
        source.read_text().replace("9990000000029", "9990000000029\u200b"),
        encoding="utf-8",
    )

    records = read_product_records(sources)

    assert records[1].gtin == "9990000000029"


def test_normalizes_quantity_that_repeats_its_unit(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "catalog.csv"
    source.write_text(
        source.read_text().replace(",250,ml,", ",250ml,ml,"),
        encoding="utf-8",
    )

    records = read_product_records(sources)

    assert records[0].content_quantity == Decimal("250")
    assert records[0].content_unit == "ml"


@pytest.mark.parametrize(
    ("source_pair", "expected_quantity", "expected_unit"),
    [("250,", Decimal("250"), None), (",ml", None, "ml")],
)
def test_preserves_partial_content_information(
    tmp_path: Path,
    source_pair: str,
    expected_quantity: Decimal | None,
    expected_unit: str | None,
) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "catalog.csv"
    source.write_text(
        source.read_text().replace(",250,ml,", f",{source_pair},"),
        encoding="utf-8",
    )

    records = read_product_records(sources)

    assert records[0].content_quantity == expected_quantity
    assert records[0].content_unit == expected_unit


def test_rejects_invalid_gtin_without_exposing_its_value(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "catalog.csv"
    source.write_text(
        source.read_text().replace("9990000000029", "9990000000028"),
        encoding="utf-8",
    )

    with pytest.raises(ProductSourceValidationError) as captured:
        read_product_records(sources)

    assert "row 3, ean: must be a valid GTIN" in str(captured.value)
    assert "9990000000028" not in str(captured.value)


def test_rejects_duplicate_gtin(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "catalog.csv"
    lines = source.read_text().splitlines()
    source.write_text("\n".join([*lines, lines[1]]) + "\n", encoding="utf-8")

    with pytest.raises(ProductSourceValidationError, match="duplicated in the source"):
        read_product_records(sources)


def test_rejects_unexpected_source_contract(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "catalog.csv"
    source.write_text(source.read_text().replace("NOM", "PRODUCT_NAME"), encoding="utf-8")

    with pytest.raises(ProductSourceError, match="supported product source contract"):
        read_product_records(sources)


def test_rejects_category_code_that_conflicts_with_mapping(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "catalog.csv"
    source.write_text(source.read_text().replace(",SKIN\n", ",OTHER\n", 1), encoding="utf-8")

    with pytest.raises(ProductSourceValidationError, match="conflicts with category mapping"):
        read_product_records(sources)


def test_uses_explicit_legacy_codes_from_reference(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "reference.csv"
    source.write_text(
        source.read_text().replace(
            "CURRENT-001,DEMO-001,2001,1001", "CURRENT-001,OLDER-001,2001,9001"
        ),
        encoding="utf-8",
    )

    record = read_product_records(sources)[0]

    assert record.legacy_internal_code == "OLDER-001"
    assert record.legacy_erp_code == "9001"


@pytest.mark.parametrize(
    ("gtin", "expected"),
    [("9990000000012", True), ("9990000000013", False), ("not-a-gtin", False)],
)
def test_validates_gtin_check_digit(gtin: str, expected: bool) -> None:
    assert is_valid_gtin(gtin) is expected
