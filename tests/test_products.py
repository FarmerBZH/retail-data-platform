from decimal import Decimal
from pathlib import Path

import pytest

from retail_data_platform.importers.products import (
    ProductSourceError,
    ProductSourceValidationError,
    is_valid_gtin,
    read_product_records,
)

FIXTURE = Path(__file__).parent / "fixtures" / "products.csv"


def test_reads_synthetic_product_catalog() -> None:
    records = read_product_records(FIXTURE)

    assert len(records) == 2
    assert records[0].gtin == "9990000000012"
    assert records[0].erp_code == "1001"
    assert records[0].content_quantity == Decimal("250")
    assert records[0].average_price == Decimal("12.50")
    assert records[0].average_price_currency == "EUR"


def test_removes_zero_width_space_before_gtin_validation(tmp_path: Path) -> None:
    source = tmp_path / "products.csv"
    source.write_text(
        FIXTURE.read_text().replace("9990000000012", "9990000000012\u200b"),
        encoding="utf-8",
    )

    records = read_product_records(source)

    assert records[0].gtin == "9990000000012"


def test_normalizes_quantity_that_repeats_its_unit(tmp_path: Path) -> None:
    source = tmp_path / "products.csv"
    source.write_text(
        FIXTURE.read_text().replace(",250,ml,", ",250ml,ml,"),
        encoding="utf-8",
    )

    records = read_product_records(source)

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
    source = tmp_path / "products.csv"
    source.write_text(
        FIXTURE.read_text().replace(",250,ml,", f",{source_pair},"),
        encoding="utf-8",
    )

    records = read_product_records(source)

    assert records[0].content_quantity == expected_quantity
    assert records[0].content_unit == expected_unit


def test_rejects_invalid_gtin_without_exposing_its_value(tmp_path: Path) -> None:
    source = tmp_path / "products.csv"
    source.write_text(
        FIXTURE.read_text().replace("9990000000012", "9990000000013"),
        encoding="utf-8",
    )

    with pytest.raises(ProductSourceValidationError) as captured:
        read_product_records(source)

    assert "row 2, ean: must be a valid GTIN" in str(captured.value)
    assert "9990000000013" not in str(captured.value)


def test_rejects_duplicate_gtin(tmp_path: Path) -> None:
    lines = FIXTURE.read_text().splitlines()
    source = tmp_path / "products.csv"
    source.write_text("\n".join([*lines, lines[1]]) + "\n", encoding="utf-8")

    with pytest.raises(ProductSourceValidationError, match="duplicated in the source"):
        read_product_records(source)


def test_rejects_unexpected_source_contract(tmp_path: Path) -> None:
    source = tmp_path / "products.csv"
    source.write_text(FIXTURE.read_text().replace("NOM", "PRODUCT_NAME"), encoding="utf-8")

    with pytest.raises(ProductSourceError, match="expected contract"):
        read_product_records(source)


@pytest.mark.parametrize(
    ("gtin", "expected"),
    [("9990000000012", True), ("9990000000013", False), ("not-a-gtin", False)],
)
def test_validates_gtin_check_digit(gtin: str, expected: bool) -> None:
    assert is_valid_gtin(gtin) is expected
