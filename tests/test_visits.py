import uuid
from pathlib import Path
from shutil import copytree

import pytest

from retail_data_platform.importers.visits import (
    StoreIdentity,
    VisitDataset,
    VisitSourceError,
    read_visit_dataset,
)

FIXTURE_ROOT = Path(__file__).parent / "fixtures" / "visit_sources"


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


def read_dataset(source_root: Path = FIXTURE_ROOT) -> VisitDataset:
    return read_visit_dataset(
        source_root / "calls",
        source_root / "crowdsourced",
        source_root / "field",
        source_root / "aliases.csv",
        store_identities(),
    )


def copy_sources(tmp_path: Path) -> Path:
    return copytree(FIXTURE_ROOT, tmp_path / "visit_sources")


def test_reads_all_activity_roles_and_preserves_unresolved_rows() -> None:
    dataset = read_dataset()

    assert dataset.rows_read == 4
    assert [record.activity_type for record in dataset.records] == [
        "calls",
        "crowdsourced_visits",
        "field_visits",
        "field_visits",
    ]
    assert [record.activity_count for record in dataset.records] == [4, 7, 2, 1]
    assert [record.store_match_status for record in dataset.records] == [
        "matched",
        "matched",
        "matched",
        "unresolved",
    ]
    assert dataset.records[0].store_match_method == "code"
    assert dataset.records[1].store_match_method == "alias"
    assert dataset.records[3].store_id is None


def test_generates_stable_record_identifiers() -> None:
    first = read_dataset()
    second = read_dataset()

    assert [record.id for record in first.records] == [record.id for record in second.records]


def test_reads_utf16_csv_source(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    csv_content = "client,visite,\nSynthetic Store A,9,\n"
    for directory in ("calls", "crowdsourced", "field"):
        html_source = next((sources / directory).glob("*.xls"))
        html_source.unlink()
        (sources / directory / "202501_activity.csv").write_bytes(csv_content.encode("utf-16"))

    dataset = read_dataset(sources)

    assert dataset.rows_read == 3
    assert all(record.store_id == uuid.UUID(int=1) for record in dataset.records)
    assert all(record.store_match_method == "name" for record in dataset.records)


def test_rejects_duplicate_month_partition(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    duplicate = sources / "calls" / "202501_duplicate.xls"
    duplicate.write_text(
        (sources / "calls" / "202501_calls.xls").read_text(),
        encoding="utf-8",
    )

    with pytest.raises(VisitSourceError, match="More than one store activity file"):
        read_dataset(sources)


def test_rejects_mismatched_month_coverage(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    (sources / "calls" / "202502_calls.xls").write_text(
        (sources / "calls" / "202501_calls.xls").read_text(),
        encoding="utf-8",
    )

    with pytest.raises(VisitSourceError, match="do not cover the same months"):
        read_dataset(sources)


def test_rejects_duplicate_source_identity(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "calls" / "202501_calls.xls"
    source.write_text(
        "<html><body><table>"
        "<tr><th>[Synthetic] [CRM-100]</th><td>4</td></tr>"
        "<tr><th>[Synthetic duplicate] [CRM-100]</th><td>5</td></tr>"
        "</table></body></html>",
        encoding="utf-8",
    )

    with pytest.raises(VisitSourceError, match="source identity is duplicated"):
        read_dataset(sources)


def test_rejects_invalid_count_without_echoing_it(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "calls" / "202501_calls.xls"
    source.write_text(source.read_text().replace(">4<", ">PRIVATE<"), encoding="utf-8")

    with pytest.raises(VisitSourceError) as captured:
        read_dataset(sources)

    assert "invalid count" in str(captured.value)
    assert "PRIVATE" not in str(captured.value)


def test_marks_ambiguous_alias_as_conflict(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    aliases = sources / "aliases.csv"
    aliases.write_text(
        aliases.read_text() + "CLIENT,SYNTHETIC-C,ALIAS-200,synthetic,ERP-300\n",
        encoding="utf-8",
    )

    dataset = read_dataset(sources)
    alias_record = next(
        record for record in dataset.records if record.activity_type == "crowdsourced_visits"
    )

    assert alias_record.store_match_status == "conflict"
    assert alias_record.store_id is None


def test_rejects_unexpected_html_shape(tmp_path: Path) -> None:
    sources = copy_sources(tmp_path)
    source = sources / "calls" / "202501_calls.xls"
    source.write_text(
        "<html><body><table><tr><th>[Synthetic] [CRM-100]</th>"
        "<td>4</td><td>5</td></tr></table></body></html>",
        encoding="utf-8",
    )

    with pytest.raises(VisitSourceError, match="unexpected shape"):
        read_dataset(sources)
