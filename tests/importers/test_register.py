import csv
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from retail_data_platform.importers.register import (
    MONTHLY_COLUMNS,
    MONTHLY_RECENT_COLUMNS,
    SUPPLEMENT_COLUMNS,
    MonthlyStoreMapping,
    RegisterRecord,
    RegisterSourceError,
    StoreIdentity,
    _iter_source_records,
    _iter_source_rows,
    _record_from_row,
    _StoreResolver,
    discover_register_sources,
    load_monthly_store_mappings,
    source_bundle_sha256,
)


def write_csv(path: Path, columns: tuple[str, ...], rows: list[list[str]], delimiter: str) -> None:
    with path.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.writer(destination, delimiter=delimiter)
        writer.writerow(columns)
        writer.writerows(rows)


def make_sources(tmp_path: Path) -> Path:
    source = tmp_path / "register_sources"
    source.mkdir()
    classic = {key: "" for key in MONTHLY_COLUMNS}
    classic.update(
        mois_annee="2025-01-01",
        mois="JANVIER",
        annee="2025",
        magasin="S-1",
        magasin_libelle="Synthetic Store One",
        ean="1000000000001",
        ean_libelle="Synthetic Product One",
        ca_total="10,009999999999",
        uvc_total="-2,0",
        ca_total_evolution="0,25",
        prix_moyen="5,005",
    )
    total = {**classic, "ean": "TOTAL"}
    write_csv(
        source / "202501_export.csv",
        MONTHLY_COLUMNS,
        [[row[key] for key in MONTHLY_COLUMNS] for row in (classic, total)],
        ";",
    )
    recent = {key: "" for key in MONTHLY_RECENT_COLUMNS}
    recent.update(
        magasin_id="S-2",
        magasin="Synthetic Store Two",
        ean="1000000000002",
        libelle_ean="Synthetic Product Two",
        volume_kg_l="3,25",
        ca_evolution="0,50",
    )
    write_csv(
        source / "202502_export.csv",
        MONTHLY_RECENT_COLUMNS,
        [[recent[key] for key in MONTHLY_RECENT_COLUMNS]],
        ";",
    )
    supplement = {key: "" for key in SUPPLEMENT_COLUMNS}
    supplement.update(
        mois_annee="1/1/2025",
        id_tdlinx="PANEL",
        id_merval="M-1",
        enseigne="Synthetic Retailer",
        marque="Synthetic Brand",
        famille="Synthetic Family",
        ean="1000000000001",
        ca="8,00",
        uvc="4",
    )
    other_store = {**supplement, "id_merval": "M-2", "ca": "7,00"}
    write_csv(
        source / "supplement.csv",
        SUPPLEMENT_COLUMNS,
        [[row[key] for key in SUPPLEMENT_COLUMNS] for row in (supplement, other_store)],
        ",",
    )
    return source


def identities() -> tuple[_StoreResolver, dict[str, uuid.UUID]]:
    stores = _StoreResolver(
        [
            StoreIdentity(uuid.UUID(int=1), "S-1", "PANEL", "M-1"),
            StoreIdentity(uuid.UUID(int=2), "S-2", "PANEL", "M-2"),
        ]
    )
    products = {"1000000000001": uuid.UUID(int=11)}
    return stores, products


def mapping_csv(path: Path, rows: str) -> Path:
    path.write_text("source_store_reference,store_erp_code,valid_from,valid_to\n" + rows)
    return path


def test_reviewed_mapping_only_resolves_its_monthly_window(tmp_path: Path) -> None:
    rules = load_monthly_store_mappings(
        mapping_csv(
            tmp_path / "mapping.csv",
            "S-1,ERP-A,2025-01-01,2025-02-01\nALIAS-A,ERP-A,2025-01-01,2025-02-01\n",
        )
    )
    a, b = uuid.UUID(int=1), uuid.UUID(int=2)
    resolver = _StoreResolver(
        [
            StoreIdentity(a, "S-1", "PANEL", "M-1", "ERP-A"),
            StoreIdentity(b, "S-1", "PANEL", "M-2", "ERP-B"),
        ],
        rules,
    )
    assert resolver.resolve("monthly", "S-1", None, date(2025, 1, 1)) == (
        a,
        "matched",
        "reviewed_monthly_mapping",
    )
    assert resolver.resolve("monthly", "ALIAS-A", None, date(2025, 2, 1))[0] == a
    assert resolver.resolve("monthly", "S-1", None, date(2025, 3, 1))[1] == "conflict"
    assert resolver.resolve("supplement", "PANEL", "M-2", date(2025, 1, 1))[0] == b


@pytest.mark.parametrize(
    "rows",
    [
        "",
        "S-1,ERP-A,2025-01-02,2025-02-01\n",
        "S-1,ERP-A,2025-03-01,2025-02-01\n",
        "S-1,ERP-A,invalid,2025-02-01\n",
        "S-1,,2025-01-01,2025-02-01\n",
        "S-1,ERP-A,2025-01-01,2025-02-01\nS1,ERP-B,2025-02-01,2025-03-01\n",
        "S-1,ERP-A,2025-01-01\n",
    ],
)
def test_rejects_malformed_or_overlapping_mappings(tmp_path: Path, rows: str) -> None:
    with pytest.raises(RegisterSourceError):
        load_monthly_store_mappings(mapping_csv(tmp_path / "mapping.csv", rows))


def test_mapping_targets_must_be_unique_and_consistent() -> None:
    rule = MonthlyStoreMapping("S1", "ERP-A", date(2025, 1, 1), date(2025, 2, 1))
    for stores in [
        [],
        [StoreIdentity(uuid.UUID(int=n), None, None, None, "ERP-A") for n in [1, 2]],
    ]:
        with pytest.raises(RegisterSourceError, match="absent or ambiguous"):
            _StoreResolver(stores, (rule,))
    resolver = _StoreResolver(
        [
            StoreIdentity(uuid.UUID(int=1), None, None, None, "ERP-A"),
            StoreIdentity(uuid.UUID(int=2), "S-1", None, None, "ERP-B"),
        ],
        (rule,),
    )
    with pytest.raises(RegisterSourceError, match="contradicts"):
        resolver.resolve("monthly", "S-1", None, date(2025, 1, 1))


def test_mapping_and_identity_changes_are_part_of_bundle_fingerprint(tmp_path: Path) -> None:
    bundle = discover_register_sources(make_sources(tmp_path))
    rule = MonthlyStoreMapping("S1", "ERP-A", date(2025, 1, 1), date(2025, 2, 1))
    stores = [StoreIdentity(uuid.UUID(int=1), "S1", None, None, "ERP-A")]
    before = source_bundle_sha256(bundle)
    mapped = source_bundle_sha256(bundle, (rule,), stores)
    assert before != mapped == source_bundle_sha256(bundle, (rule,), stores)
    assert mapped != source_bundle_sha256(
        bundle, (rule,), [StoreIdentity(uuid.UUID(int=2), "S1", None, None, "ERP-A")]
    )


def test_mapping_errors_do_not_echo_private_paths_or_values(tmp_path: Path) -> None:
    for path in [
        tmp_path / "PRIVATE.csv",
        mapping_csv(tmp_path / "mapping.csv", "PRIVATE,PRIVATE,bad,bad\n"),
    ]:
        with pytest.raises(RegisterSourceError) as error:
            load_monthly_store_mappings(path)
        assert "PRIVATE" not in str(error.value)


def read_records(source: Path) -> list[RegisterRecord]:
    bundle = discover_register_sources(source)
    stores, products = identities()
    records: list[RegisterRecord] = []
    for source_file in (*bundle.monthly, bundle.supplement):
        for line, row in _iter_source_rows(source_file):
            record = _record_from_row(row, source_file, line, stores, products)
            if record is not None:
                records.append(record)
    return records


def test_preserves_source_grain_and_nullable_measures(tmp_path: Path) -> None:
    source = make_sources(tmp_path)
    records = read_records(source)

    assert len(records) == 4
    assert len({record.id for record in records}) == 4
    classic = next(
        row for row in records if row.source_kind == "monthly" and row.period == date(2025, 1, 1)
    )
    assert classic.revenue_value == Decimal("10.01")
    assert classic.units_sold == -2
    assert classic.revenue_change_ratio == Decimal("0.25000000")
    assert classic.average_unit_price == Decimal("5.005000")
    recent = next(
        row for row in records if row.source_kind == "monthly" and row.period == date(2025, 2, 1)
    )
    assert recent.revenue_value is None
    assert recent.units_sold is None
    assert recent.volume_value == Decimal("3.250000")
    assert recent.product_match_status == "unresolved"
    supplements = [row for row in records if row.source_kind == "supplement"]
    assert {row.store_id for row in supplements} == {uuid.UUID(int=1), uuid.UUID(int=2)}
    assert {row.store_match_method for row in supplements} == {"legacy_store_id+retail_panel_code"}


def test_deterministic_identifiers(tmp_path: Path) -> None:
    source = make_sources(tmp_path)
    assert [row.id for row in read_records(source)] == [row.id for row in read_records(source)]


def test_rejects_bad_measure_without_echoing_private_value(tmp_path: Path) -> None:
    source = make_sources(tmp_path)
    path = source / "202501_export.csv"
    path.write_text(path.read_text().replace("10,009999999999", "PRIVATE"))

    with pytest.raises(RegisterSourceError) as captured:
        read_records(source)
    assert "invalid ca_total value" in str(captured.value)
    assert "PRIVATE" not in str(captured.value)


def test_rejects_period_mismatch(tmp_path: Path) -> None:
    source = make_sources(tmp_path)
    path = source / "202501_export.csv"
    path.write_text(path.read_text().replace("2025-01-01", "2025-03-01"))

    with pytest.raises(RegisterSourceError, match="disagrees with its file period"):
        read_records(source)


def test_rejects_partition_gap(tmp_path: Path) -> None:
    source = make_sources(tmp_path)
    (source / "202502_export.csv").rename(source / "202503_export.csv")

    with pytest.raises(RegisterSourceError, match="have a gap"):
        discover_register_sources(source)


def test_rejects_duplicate_business_identity(tmp_path: Path) -> None:
    source = make_sources(tmp_path)
    path = source / "202501_export.csv"
    with path.open("r", encoding="utf-8", newline="") as input_file:
        rows = list(csv.reader(input_file, delimiter=";"))
    write_csv(path, MONTHLY_COLUMNS, [rows[1], rows[1], rows[2]], ";")
    monthly = discover_register_sources(source).monthly[0]
    stores, products = identities()

    with pytest.raises(RegisterSourceError, match="duplicates a source business identity"):
        list(_iter_source_records(monthly, stores, products))


def test_reads_cp1252_values(tmp_path: Path) -> None:
    source = make_sources(tmp_path)
    path = source / "202501_export.csv"
    original = path.read_text()
    path.write_bytes(original.replace("Synthetic Store One", "Magasin accentué").encode("cp1252"))

    records = read_records(source)
    classic = next(row for row in records if row.source_kind == "monthly" and row.period.month == 1)
    assert classic.source_store_label == "Magasin accentué"


def test_store_reference_conflict_remains_unmatched() -> None:
    stores = _StoreResolver(
        [
            StoreIdentity(uuid.UUID(int=1), None, "PANEL-1", "LEGACY-1"),
            StoreIdentity(uuid.UUID(int=2), None, "PANEL-2", "LEGACY-2"),
        ]
    )

    assert stores.resolve("supplement", "PANEL-1", "LEGACY-2") == (
        None,
        "conflict",
        "legacy_store_id+retail_panel_code",
    )


def test_monthly_store_code_does_not_fall_back_to_another_identifier_namespace() -> None:
    stores = _StoreResolver(
        [
            StoreIdentity(uuid.UUID(int=1), "SHARED-1", None, "LEGACY-1"),
            StoreIdentity(uuid.UUID(int=2), None, None, "SHARED-1"),
        ]
    )

    assert stores.resolve("monthly", "SHARED-1", None) == (
        uuid.UUID(int=1),
        "matched",
        "data_sharing_code",
    )
    assert stores.resolve("monthly", "LEGACY-1", None) == (None, "unresolved", None)
