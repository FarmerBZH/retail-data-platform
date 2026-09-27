import uuid
from pathlib import Path
from shutil import copytree

import pytest

from retail_data_platform.importers.numeric_distribution import (
    DistributionDataset,
    NumericDistributionSourceError,
    ProductIdentity,
    StoreIdentity,
    iter_distribution_records,
    read_distribution_dataset,
)

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "numeric_distribution_sources"


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


def product_identities() -> list[ProductIdentity]:
    return [
        ProductIdentity(
            uuid.UUID(int=11),
            "1000000000001",
            None,
            None,
            "INT-A1",
            None,
            "Synthetic Product A1",
            "CAT-A",
        ),
        ProductIdentity(
            uuid.UUID(int=12),
            "1000000000002",
            None,
            None,
            "INT-A2",
            None,
            "Synthetic Product A2",
            "CAT-A",
        ),
        ProductIdentity(
            uuid.UUID(int=13),
            "1000000000003",
            None,
            None,
            "INT-B1",
            None,
            "Synthetic Product B",
            "CAT-B",
        ),
        ProductIdentity(
            uuid.UUID(int=14),
            "1000000000004",
            None,
            None,
            "INT-C1",
            None,
            "Synthetic Product C",
            "CAT-C",
        ),
    ]


def read_dataset(source_root: Path = FIXTURE_ROOT) -> DistributionDataset:
    return read_distribution_dataset(
        source_root,
        source_root / "aliases.csv",
        store_identities(),
        product_identities(),
    )


def copy_sources(tmp_path: Path) -> Path:
    return copytree(FIXTURE_ROOT, tmp_path / "numeric_distribution_sources")


def test_materializes_reported_presence_and_inferred_absence() -> None:
    dataset = read_dataset()
    records = list(iter_distribution_records(dataset))

    assert dataset.rows_read == 6
    assert dataset.rows_loaded == 7
    assert dataset.duplicate_rows == 0
    assert len(records) == 7
    assert sum(record.presence_value for record in records) == 6
    inferred = [record for record in records if record.value_origin == "inferred_absence"]
    assert len(inferred) == 1
    assert inferred[0].presence_value == 0
    assert inferred[0].category_code == "CAT-A"


def test_reconciles_store_and_product_aliases() -> None:
    records = list(iter_distribution_records(read_dataset()))
    alias_record = next(
        record
        for record in records
        if record.source_store_reference == "ALIAS-S2"
        and record.source_product_reference == "ALIAS-A2"
    )

    assert alias_record.store_id == uuid.UUID(int=2)
    assert alias_record.store_match_method == "alias"
    assert alias_record.product_id == uuid.UUID(int=12)
    assert alias_record.product_match_method == "alias"
    assert alias_record.presence_value == 0


def test_uses_source_specific_alias_before_ambiguous_generic_alias(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    aliases = sources / "aliases.csv"
    aliases.write_text(
        aliases.read_text() + "PRODUCT,SYNTHETIC-B1,ALIAS-A2,category-b,1000000000003\n",
        encoding="utf-8",
    )

    records = list(iter_distribution_records(read_dataset(sources)))
    category_a_aliases = [
        record
        for record in records
        if record.source_product_reference == "ALIAS-A2" and record.category_code == "CAT-A"
    ]

    assert category_a_aliases
    assert {record.product_id for record in category_a_aliases} == {uuid.UUID(int=12)}


def test_generates_stable_record_identifiers() -> None:
    first = list(iter_distribution_records(read_dataset()))
    second = list(iter_distribution_records(read_dataset()))

    assert [record.id for record in first] == [record.id for record in second]


def test_consolidates_equal_duplicate_observations(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "category-b" / "202501_distribution.xls"
    content = source.read_text()
    duplicate = (
        "<tr><th>[Synthetic] [ERP-300]</th>"
        "<th>[Synthetic] [Item] [PRODUIT] [1000000000003]</th><td>1</td></tr>"
    )
    source.write_text(content.replace("</table>", f"{duplicate}</table>"), encoding="utf-8")

    dataset = read_dataset(sources)

    assert dataset.rows_read == 7
    assert dataset.duplicate_rows == 1
    assert dataset.rows_loaded == 7


def test_rejects_conflicting_duplicate_observations(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "category-b" / "202501_distribution.xls"
    content = source.read_text()
    conflict = (
        "<tr><th>[Synthetic] [ERP-300]</th>"
        "<th>[Synthetic] [Item] [PRODUIT] [1000000000003]</th><td>0</td></tr>"
    )
    source.write_text(content.replace("</table>", f"{conflict}</table>"), encoding="utf-8")

    with pytest.raises(NumericDistributionSourceError, match="conflicting values"):
        read_dataset(sources)


def test_rejects_non_binary_values_without_echoing_them(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "category-b" / "202501_distribution.xls"
    source.write_text(source.read_text().replace(">1<", ">PRIVATE<"), encoding="utf-8")

    with pytest.raises(NumericDistributionSourceError) as captured:
        read_dataset(sources)

    assert "non-binary value" in str(captured.value)
    assert "PRIVATE" not in str(captured.value)


def test_rejects_mismatched_period_coverage(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    extra = sources / "category-a" / "202502_distribution.xls"
    extra.write_text(
        (sources / "category-a" / "202501_distribution.xls").read_text(),
        encoding="utf-8",
    )

    with pytest.raises(NumericDistributionSourceError, match="do not cover the same months"):
        read_dataset(sources)


def test_reads_cp1252_csv_source(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "category-c" / "202501_distribution.csv"
    source.write_bytes(
        "client,produit,dn,\nSynthetic Store A,Synthetic Product C,1,\n"
        "Synthetic Store B,Synthetic Product C,1,\n"
        "Synthetic Store B,Produit accentué,1,\n".encode("cp1252")
    )

    dataset = read_dataset(sources)

    assert dataset.rows_read == 7
    assert dataset.rows_loaded == 9
