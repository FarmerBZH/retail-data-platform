from __future__ import annotations

import csv
import hashlib
import re
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, delete, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from retail_data_platform.database.models import (
    ImportRun,
    ImportStatus,
    Store,
    StoreActivityMetric,
)
from retail_data_platform.database.session import create_database_engine

DATASET = "store_activity_metrics"
SOURCE_BUNDLE_NAME = "monthly store activity source bundle"
IMPORT_CONTRACT_VERSION = "1"
MAX_SOURCE_BYTES = 5_000_000
DATABASE_BATCH_SIZE = 1_000
UUID_NAMESPACE = uuid.UUID("7b7d859d-a0ae-461f-931d-b4f4ea4eadad")
ACTIVITY_TYPES = ("calls", "crowdsourced_visits", "field_visits")
ALIAS_COLUMNS = (
    "category",
    "normalized_id",
    "raw_values",
    "sources",
    "correspondance_avec_le_fichier_magasin_codesap_ou_produits_ean",
)


@dataclass(frozen=True, slots=True)
class StoreIdentity:
    id: uuid.UUID
    external_network_code: str | None
    crm_code: str | None
    erp_code: str | None
    legacy_store_id: str | None
    retail_panel_code: str | None
    data_sharing_code: str | None
    name: str | None
    legal_name: str | None


@dataclass(frozen=True, slots=True)
class ActivitySource:
    activity_type: str
    period: date
    path: Path


@dataclass(frozen=True, slots=True)
class VisitSources:
    monthly: tuple[ActivitySource, ...]
    aliases: Path


@dataclass(frozen=True, slots=True)
class StoreActivityRecord:
    id: uuid.UUID
    source_key: str
    period: date
    store_id: uuid.UUID | None
    store_match_status: str
    store_match_method: str | None
    activity_type: str
    activity_count: int
    source_store_reference: str
    source_store_label: str


@dataclass(frozen=True, slots=True)
class VisitDataset:
    records: tuple[StoreActivityRecord, ...]
    rows_read: int


@dataclass(frozen=True, slots=True)
class ImportSummary:
    rows_read: int
    rows_loaded: int
    skipped: bool


class VisitSourceError(ValueError):
    """Raised when store activity sources cannot be safely processed."""


def clean_text(value: str | None) -> str:
    if value is None:
        return ""
    return unicodedata.normalize("NFKC", value).replace("\ufeff", "").replace("\u200b", "").strip()


def normalize_header(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", clean_text(value))
        .encode("ascii", errors="ignore")
        .decode("ascii")
        .lower()
    )
    return re.sub(r"[^a-z0-9]+", "_", ascii_value).strip("_")


def normalize_key(value: str | None) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", clean_text(value))
        .encode("ascii", errors="ignore")
        .decode("ascii")
        .upper()
    )
    return re.sub(r"[^A-Z0-9]", "", ascii_value)


def discover_visit_sources(
    calls_directory: Path,
    crowdsourced_directory: Path,
    field_directory: Path,
    aliases_file: Path,
) -> VisitSources:
    monthly: list[ActivitySource] = []
    period_sets: dict[str, set[date]] = {}
    for activity_type, directory in (
        ("calls", calls_directory),
        ("crowdsourced_visits", crowdsourced_directory),
        ("field_visits", field_directory),
    ):
        if not directory.is_dir():
            raise VisitSourceError("Each store activity source must be an existing directory")
        periods: set[date] = set()
        for path in sorted(directory.iterdir()):
            if path.suffix.lower() not in {".xls", ".csv"}:
                continue
            _validate_monthly_file(path)
            period = _month_from_name(path.name)
            if period in periods:
                raise VisitSourceError(
                    "More than one store activity file exists for a source role and month"
                )
            periods.add(period)
            monthly.append(ActivitySource(activity_type, period, path))
        if not periods:
            raise VisitSourceError("A store activity source directory contains no monthly files")
        period_sets[activity_type] = periods
    if len({frozenset(periods) for periods in period_sets.values()}) != 1:
        raise VisitSourceError("Store activity source roles do not cover the same months")
    _validate_alias_file(aliases_file)
    return VisitSources(
        monthly=tuple(sorted(monthly, key=lambda source: (source.period, source.activity_type))),
        aliases=aliases_file,
    )


def source_bundle_sha256(sources: VisitSources) -> str:
    digest = hashlib.sha256()
    digest.update(f"{DATASET}:{IMPORT_CONTRACT_VERSION}".encode())
    for source in sources.monthly:
        digest.update(f"{source.activity_type}:{source.period.isoformat()}".encode())
        _update_digest(digest, source.path)
    digest.update(b"aliases")
    _update_digest(digest, sources.aliases)
    return digest.hexdigest()


def read_visit_dataset(
    calls_directory: Path,
    crowdsourced_directory: Path,
    field_directory: Path,
    aliases_file: Path,
    stores: list[StoreIdentity],
) -> VisitDataset:
    sources = discover_visit_sources(
        calls_directory,
        crowdsourced_directory,
        field_directory,
        aliases_file,
    )
    aliases = _read_aliases(sources.aliases)
    resolver = _StoreResolver(stores, aliases)
    records: list[StoreActivityRecord] = []
    seen_source_keys: set[str] = set()
    for source in sources.monthly:
        rows = _read_monthly_rows(source)
        for row_number, (label, reference, activity_count) in enumerate(rows, start=1):
            source_key = hashlib.sha256(
                (
                    f"{source.activity_type}|{source.period.isoformat()}|{normalize_key(reference)}"
                ).encode()
            ).hexdigest()
            if source_key in seen_source_keys:
                raise VisitSourceError("A monthly store activity source identity is duplicated")
            seen_source_keys.add(source_key)
            if not reference or len(reference) > 128 or not label or len(label) > 512:
                raise VisitSourceError(
                    f"Store activity row {row_number} has an invalid store reference"
                )
            store_id, status, method = resolver.resolve(reference, label)
            records.append(
                StoreActivityRecord(
                    id=uuid.uuid5(UUID_NAMESPACE, f"store-activity:{source_key}"),
                    source_key=source_key,
                    period=source.period,
                    store_id=store_id,
                    store_match_status=status,
                    store_match_method=method,
                    activity_type=source.activity_type,
                    activity_count=activity_count,
                    source_store_reference=reference,
                    source_store_label=label,
                )
            )
    return VisitDataset(records=tuple(records), rows_read=len(records))


def import_visits(
    calls_directory: Path,
    crowdsourced_directory: Path,
    field_directory: Path,
    aliases_file: Path,
    engine: Engine | None = None,
) -> ImportSummary:
    sources = discover_visit_sources(
        calls_directory,
        crowdsourced_directory,
        field_directory,
        aliases_file,
    )
    database_engine = engine or create_database_engine()
    checksum = source_bundle_sha256(sources)
    with Session(database_engine) as session:
        previous_run = session.scalar(
            select(ImportRun.id).where(
                ImportRun.dataset == DATASET,
                ImportRun.source_sha256 == checksum,
                ImportRun.status == ImportStatus.SUCCEEDED.value,
            )
        )
        if previous_run is not None:
            return ImportSummary(rows_read=0, rows_loaded=0, skipped=True)
        stores = [
            StoreIdentity(*row)
            for row in session.execute(
                select(
                    Store.id,
                    Store.external_network_code,
                    Store.crm_code,
                    Store.erp_code,
                    Store.legacy_store_id,
                    Store.retail_panel_code,
                    Store.data_sharing_code,
                    Store.name,
                    Store.legal_name,
                )
            ).all()
        ]
        if not stores:
            raise VisitSourceError("Stores must be imported before store activities")
        run = ImportRun(
            dataset=DATASET,
            source_file_name=SOURCE_BUNDLE_NAME,
            source_sha256=checksum,
            status=ImportStatus.RUNNING.value,
        )
        session.add(run)
        session.flush()
        run_id = run.id
        session.commit()
    try:
        dataset = read_visit_dataset(
            calls_directory,
            crowdsourced_directory,
            field_directory,
            aliases_file,
            stores,
        )
        _publish_visits(database_engine, run_id, dataset)
    except Exception as error:
        _mark_import_failed(database_engine, run_id, error)
        raise
    return ImportSummary(dataset.rows_read, len(dataset.records), False)


class _StoreResolver:
    def __init__(self, stores: list[StoreIdentity], aliases: dict[str, set[str]]) -> None:
        self.aliases = aliases
        self.codes: dict[str, set[uuid.UUID]] = defaultdict(set)
        self.names: dict[str, set[uuid.UUID]] = defaultdict(set)
        self.erp_codes: dict[str, set[uuid.UUID]] = defaultdict(set)
        for store in stores:
            for value in (
                store.external_network_code,
                store.crm_code,
                store.erp_code,
                store.legacy_store_id,
                store.retail_panel_code,
                store.data_sharing_code,
            ):
                key = normalize_key(value)
                if key:
                    self.codes[key].add(store.id)
            erp_key = normalize_key(store.erp_code)
            if erp_key:
                self.erp_codes[erp_key].add(store.id)
            for value in (store.name, store.legal_name):
                key = normalize_key(value)
                if key:
                    self.names[key].add(store.id)

    def resolve(self, reference: str, label: str) -> tuple[uuid.UUID | None, str, str | None]:
        candidate_groups: list[set[uuid.UUID]] = []
        methods: list[str] = []
        reference_key = normalize_key(reference)
        label_key = normalize_key(label)
        if self.codes.get(reference_key):
            candidate_groups.append(self.codes[reference_key])
            methods.append("code")
        for key in {reference_key, label_key}:
            if key and self.names.get(key):
                candidate_groups.append(self.names[key])
                methods.append("name")
            alias_targets = self.aliases.get(key, set())
            alias_candidates = set().union(
                *(self.erp_codes.get(target, set()) for target in alias_targets)
            )
            if alias_candidates:
                candidate_groups.append(alias_candidates)
                methods.append("alias")
        if not candidate_groups:
            return None, "unresolved", None
        intersection = set.intersection(*candidate_groups)
        union = set.union(*candidate_groups)
        resolved = intersection if len(intersection) == 1 else union if len(union) == 1 else set()
        method = "+".join(sorted(set(methods)))
        if len(resolved) == 1:
            return next(iter(resolved)), "matched", method
        return None, "conflict", method or "multiple_candidates"


class _ActivityTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[tuple[list[str], list[str]]] = []
        self._row_headers: list[str] = []
        self._row_values: list[str] = []
        self._cell_kind: str | None = None
        self._cell_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        if tag.lower() == "tr":
            self._row_headers = []
            self._row_values = []
        elif tag.lower() in {"th", "td"}:
            self._cell_kind = tag.lower()
            self._cell_text = []

    def handle_data(self, data: str) -> None:
        if self._cell_kind is not None:
            self._cell_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        if normalized_tag in {"th", "td"} and self._cell_kind == normalized_tag:
            value = clean_text("".join(self._cell_text))
            target = self._row_headers if normalized_tag == "th" else self._row_values
            target.append(value)
            self._cell_kind = None
            self._cell_text = []
        elif normalized_tag == "tr" and (self._row_headers or self._row_values):
            self.rows.append((self._row_headers.copy(), self._row_values.copy()))


def _read_monthly_rows(source: ActivitySource) -> list[tuple[str, str, int]]:
    raw = source.path.read_bytes()
    if source.path.suffix.lower() == ".csv":
        return _read_csv_activity(raw)
    return _read_html_activity(raw)


def _read_html_activity(raw: bytes) -> list[tuple[str, str, int]]:
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise VisitSourceError("A store activity HTML file has an unsupported encoding") from error
    parser = _ActivityTableParser()
    parser.feed(content)
    rows: list[tuple[str, str, int]] = []
    for row_number, (headers, values) in enumerate(parser.rows, start=1):
        if not headers or not values:
            continue
        if len(headers) != 1 or len(values) != 1:
            raise VisitSourceError(f"Store activity HTML row {row_number} has an unexpected shape")
        label = headers[0]
        reference = _reference_from_html_label(label, row_number)
        rows.append((label, reference, _parse_activity_count(values[0], row_number)))
    if not rows:
        raise VisitSourceError("A store activity HTML file contains no data rows")
    return rows


def _read_csv_activity(raw: bytes) -> list[tuple[str, str, int]]:
    encoding = "utf-16" if raw[:2] in {b"\xff\xfe", b"\xfe\xff"} else "utf-8-sig"
    try:
        content = raw.decode(encoding)
    except UnicodeDecodeError as error:
        raise VisitSourceError("A store activity CSV file has an unsupported encoding") from error
    csv_rows = [row for row in csv.reader(content.splitlines()) if any(clean_text(v) for v in row)]
    if not csv_rows:
        raise VisitSourceError("A store activity CSV file is empty")
    headers = [normalize_header(value) for value in csv_rows[0]]
    while headers and not headers[-1]:
        headers.pop()
    if tuple(headers) != ("client", "visite"):
        raise VisitSourceError("A store activity CSV file has an unexpected contract")
    rows: list[tuple[str, str, int]] = []
    for row_number, raw_values in enumerate(csv_rows[1:], start=2):
        values = [clean_text(value) for value in raw_values]
        while len(values) > len(headers) and not values[-1]:
            values.pop()
        if len(values) != len(headers):
            raise VisitSourceError(f"Store activity CSV row {row_number} has an unexpected width")
        label = values[0]
        if not label:
            raise VisitSourceError(f"Store activity CSV row {row_number} has no store reference")
        rows.append((label, label, _parse_activity_count(values[1], row_number)))
    if not rows:
        raise VisitSourceError("A store activity CSV file contains no data rows")
    return rows


def _reference_from_html_label(label: str, row_number: int) -> str:
    groups = re.findall(r"\[([^\[\]]+)\]", label)
    if not groups:
        raise VisitSourceError(
            f"Store activity HTML row {row_number} has no bracketed store reference"
        )
    tokens = groups[-1].split()
    if not tokens:
        raise VisitSourceError(f"Store activity HTML row {row_number} has an empty store reference")
    return clean_text(tokens[-1])


def _parse_activity_count(value: str, row_number: int) -> int:
    normalized = clean_text(value).replace("\u00a0", "").replace(" ", "")
    if not normalized.isdigit():
        raise VisitSourceError(f"Store activity row {row_number} has an invalid count")
    result = int(normalized)
    if result < 0:
        raise VisitSourceError(f"Store activity row {row_number} has an invalid count")
    return result


def _read_aliases(path: Path) -> dict[str, set[str]]:
    raw = path.read_bytes()
    encoding = "utf-16" if raw[:2] in {b"\xff\xfe", b"\xfe\xff"} else "utf-8-sig"
    try:
        content = raw.decode(encoding)
    except UnicodeDecodeError as error:
        raise VisitSourceError("Alias source has an unsupported encoding") from error
    rows = [row for row in csv.reader(content.splitlines()) if any(clean_text(v) for v in row)]
    if not rows:
        raise VisitSourceError("Alias source is empty")
    headers = [normalize_header(value) for value in rows[0]]
    if tuple(headers) != ALIAS_COLUMNS:
        raise VisitSourceError("Alias source has an unexpected contract")
    aliases: dict[str, set[str]] = defaultdict(set)
    for row_number, values in enumerate(rows[1:], start=2):
        if len(values) != len(headers):
            raise VisitSourceError(f"Alias row {row_number} has an unexpected width")
        row = dict(zip(headers, values, strict=True))
        if normalize_key(row["category"]) != "CLIENT":
            continue
        target = normalize_key(row[ALIAS_COLUMNS[-1]])
        if not target:
            continue
        for field in ("raw_values", "normalized_id"):
            alias = normalize_key(row[field])
            if alias:
                aliases[alias].add(target)
    return dict(aliases)


def _month_from_name(name: str) -> date:
    match = re.match(r"^(\d{4})(\d{2})", name)
    if match is None:
        raise VisitSourceError("Monthly store activity filename must start with YYYYMM")
    try:
        return date(int(match.group(1)), int(match.group(2)), 1)
    except ValueError as error:
        raise VisitSourceError("Monthly store activity filename has an invalid month") from error


def _validate_monthly_file(path: Path) -> None:
    if not path.is_file() or path.suffix.lower() not in {".xls", ".csv"}:
        raise VisitSourceError("Store activity sources must be existing XLS or CSV files")
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise VisitSourceError("A store activity source exceeds the 5 MB limit")
    prefix = path.read_bytes()[:512].lstrip().lower()
    if path.suffix.lower() == ".xls" and not (prefix.startswith(b"<") and b"html" in prefix):
        raise VisitSourceError("An XLS store activity source is not an HTML table")


def _validate_alias_file(path: Path) -> None:
    if not path.is_file() or path.suffix.lower() != ".csv":
        raise VisitSourceError("Store activity aliases must be an existing CSV file")
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise VisitSourceError("Store activity alias source exceeds the 5 MB limit")


def _update_digest(digest: Any, path: Path) -> None:
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)


def _publish_visits(engine: Engine, run_id: uuid.UUID, dataset: VisitDataset) -> None:
    with Session(engine) as session, session.begin():
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:dataset))"),
            {"dataset": DATASET},
        )
        session.execute(select(ImportRun.id).where(ImportRun.id == run_id).with_for_update())
        session.execute(delete(StoreActivityMetric))
        _insert_batches(session, StoreActivityMetric, dataset.records)
        session.execute(
            update(ImportRun)
            .where(ImportRun.id == run_id)
            .values(
                status=ImportStatus.SUCCEEDED.value,
                rows_read=dataset.rows_read,
                rows_inserted=len(dataset.records),
                rows_rejected=0,
                completed_at=datetime.now(UTC),
            )
        )


def _insert_batches(session: Session, model: Any, records: tuple[Any, ...]) -> None:
    for offset in range(0, len(records), DATABASE_BATCH_SIZE):
        session.execute(
            insert(model),
            [asdict(record) for record in records[offset : offset + DATABASE_BATCH_SIZE]],
        )


def _mark_import_failed(engine: Engine, run_id: uuid.UUID, error: Exception) -> None:
    with Session(engine) as session, session.begin():
        session.execute(
            update(ImportRun)
            .where(ImportRun.id == run_id)
            .values(
                status=ImportStatus.FAILED.value,
                error_message=str(error)[:2000],
                completed_at=datetime.now(UTC),
            )
        )
