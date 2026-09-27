from __future__ import annotations

import csv
import hashlib
import re
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, delete, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from retail_data_platform.database.models import (
    ImportRun,
    ImportStatus,
    NumericDistributionObservation,
    ShelfShareObservation,
    Store,
)
from retail_data_platform.database.session import create_database_engine

DATASET = "shelf_share"
SOURCE_BUNDLE_NAME = "monthly shelf share source bundle"
IMPORT_CONTRACT_VERSION = "1"
MAX_SOURCE_BYTES = 10_000_000
DATABASE_BATCH_SIZE = 1_000
UUID_NAMESPACE = uuid.UUID("17c47f6b-771d-49ad-81be-790e8db48db0")
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
class SourceFile:
    category_name: str
    period: date
    path: Path


@dataclass(frozen=True, slots=True)
class SourceBundle:
    monthly: tuple[SourceFile, ...]
    aliases: Path


@dataclass(frozen=True, slots=True)
class ShelfShareRecord:
    id: uuid.UUID
    source_key: str
    period: date
    category_code: str
    store_id: uuid.UUID | None
    store_match_status: str
    store_match_method: str | None
    company_value: Decimal
    total_value: Decimal
    share: Decimal | None
    source_row_count: int
    source_category_name: str
    source_store_reference: str
    source_store_label: str


@dataclass(frozen=True, slots=True)
class ShelfShareDataset:
    records: tuple[ShelfShareRecord, ...]
    rows_read: int
    duplicate_rows: int


@dataclass(frozen=True, slots=True)
class ImportSummary:
    rows_read: int
    rows_loaded: int
    rows_aggregated: int
    skipped: bool


class ShelfShareSourceError(ValueError):
    """Raised when shelf share sources cannot be processed safely."""


def clean_text(value: str | None) -> str:
    if value is None:
        return ""
    return unicodedata.normalize("NFKC", value).replace("\ufeff", "").replace("\u200b", "").strip()


def normalize_key(value: str | None) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", clean_text(value))
        .encode("ascii", errors="ignore")
        .decode("ascii")
        .upper()
    )
    return re.sub(r"[^A-Z0-9]", "", ascii_value)


def normalize_header(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", clean_text(value))
        .encode("ascii", errors="ignore")
        .decode("ascii")
        .lower()
    )
    return re.sub(r"[^a-z0-9]+", "_", ascii_value).strip("_")


def discover_shelf_share_sources(source_directory: Path, aliases_file: Path) -> SourceBundle:
    if not source_directory.is_dir():
        raise ShelfShareSourceError("Shelf share source must be an existing directory")
    categories = sorted(path for path in source_directory.iterdir() if path.is_dir())
    if len(categories) != 3:
        raise ShelfShareSourceError("Shelf share source must contain exactly three categories")
    monthly: list[SourceFile] = []
    period_sets: list[set[date]] = []
    category_keys: set[str] = set()
    for directory in categories:
        category_name = clean_text(directory.name)
        category_key = normalize_key(category_name)
        if not category_key or category_key in category_keys or len(category_name) > 128:
            raise ShelfShareSourceError("Shelf share category has an invalid identity")
        category_keys.add(category_key)
        periods: set[date] = set()
        for path in sorted(directory.iterdir()):
            if path.suffix.lower() not in {".xls", ".csv"}:
                continue
            _validate_monthly_file(path)
            period = _month_from_name(path.name)
            if period in periods:
                raise ShelfShareSourceError(
                    "More than one shelf share file exists for a category and month"
                )
            periods.add(period)
            monthly.append(SourceFile(category_name, period, path))
        if not periods:
            raise ShelfShareSourceError("A shelf share category contains no monthly files")
        period_sets.append(periods)
    if len({frozenset(periods) for periods in period_sets}) != 1:
        raise ShelfShareSourceError("Shelf share categories do not cover the same months")
    if not aliases_file.is_file() or aliases_file.suffix.lower() != ".csv":
        raise ShelfShareSourceError("Shelf share aliases must be an existing CSV file")
    if aliases_file.stat().st_size > MAX_SOURCE_BYTES:
        raise ShelfShareSourceError("Shelf share alias source exceeds the size limit")
    return SourceBundle(
        monthly=tuple(sorted(monthly, key=lambda source: (source.period, source.category_name))),
        aliases=aliases_file,
    )


def source_bundle_sha256(sources: SourceBundle) -> str:
    digest = hashlib.sha256()
    digest.update(f"{DATASET}:{IMPORT_CONTRACT_VERSION}".encode())
    for source in sources.monthly:
        digest.update(f"{normalize_key(source.category_name)}:{source.period.isoformat()}".encode())
        _update_digest(digest, source.path)
    digest.update(b"aliases")
    _update_digest(digest, sources.aliases)
    return digest.hexdigest()


def read_shelf_share_dataset(
    source_directory: Path,
    aliases_file: Path,
    stores: list[StoreIdentity],
    category_codes: dict[str, str],
) -> ShelfShareDataset:
    sources = discover_shelf_share_sources(source_directory, aliases_file)
    aliases = _read_store_aliases(sources.aliases)
    resolver = _StoreResolver(stores, aliases)
    normalized_categories = {normalize_key(name): code for name, code in category_codes.items()}
    records: list[ShelfShareRecord] = []
    rows_read = 0
    for source in sources.monthly:
        category_key = normalize_key(source.category_name)
        category_code = normalized_categories.get(category_key)
        if not category_code:
            raise ShelfShareSourceError("A shelf share category has no distribution mapping")
        grouped: dict[str, tuple[str, str, Decimal, Decimal, int]] = {}
        for row_number, (label, reference, company, total) in enumerate(
            _read_monthly_rows(source.path), start=1
        ):
            rows_read += 1
            reference_key = normalize_key(reference)
            if not reference_key or len(reference) > 128 or not label or len(label) > 512:
                raise ShelfShareSourceError(
                    f"Shelf share row {row_number} has an invalid store reference"
                )
            if reference_key in grouped:
                old_label, old_reference, old_company, old_total, old_count = grouped[reference_key]
                grouped[reference_key] = (
                    old_label,
                    old_reference,
                    old_company + company,
                    old_total + total,
                    old_count + 1,
                )
            else:
                grouped[reference_key] = (label, reference, company, total, 1)
        for reference_key, (label, reference, company, total, count) in sorted(grouped.items()):
            if company >= Decimal("10000000000000000") or total >= Decimal("10000000000000000"):
                raise ShelfShareSourceError(
                    "An aggregated shelf share measure exceeds the database range"
                )
            store_id, status, method = resolver.resolve(reference, label)
            share = (
                (company / total).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
                if total > 0
                else None
            )
            if share is not None and abs(share) >= Decimal("10000"):
                raise ShelfShareSourceError(
                    "An aggregated shelf share ratio exceeds the database range"
                )
            source_key = hashlib.sha256(
                f"{category_key}|{source.period.isoformat()}|{reference_key}".encode()
            ).hexdigest()
            records.append(
                ShelfShareRecord(
                    id=uuid.uuid5(UUID_NAMESPACE, f"shelf-share:{source_key}"),
                    source_key=source_key,
                    period=source.period,
                    category_code=category_code,
                    store_id=store_id,
                    store_match_status=status,
                    store_match_method=method,
                    company_value=company,
                    total_value=total,
                    share=share,
                    source_row_count=count,
                    source_category_name=source.category_name,
                    source_store_reference=reference,
                    source_store_label=label,
                )
            )
    return ShelfShareDataset(tuple(records), rows_read, rows_read - len(records))


def import_shelf_share(
    source_directory: Path,
    aliases_file: Path,
    engine: Engine | None = None,
) -> ImportSummary:
    sources = discover_shelf_share_sources(source_directory, aliases_file)
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
            return ImportSummary(0, 0, 0, True)
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
            raise ShelfShareSourceError("Stores must be imported before shelf share")
        category_pairs = session.execute(
            select(
                NumericDistributionObservation.source_category_name,
                NumericDistributionObservation.category_code,
            ).distinct()
        ).all()
        category_codes: dict[str, str] = {}
        for name, code in category_pairs:
            key = normalize_key(name)
            if key in category_codes and category_codes[key] != code:
                raise ShelfShareSourceError(
                    "A distribution source category has conflicting mappings"
                )
            category_codes[key] = code
        if len(category_codes) != 3:
            raise ShelfShareSourceError("Numeric distribution must be imported before shelf share")
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
        dataset = read_shelf_share_dataset(source_directory, aliases_file, stores, category_codes)
        _publish_shelf_share(database_engine, run_id, dataset)
    except Exception as error:
        _mark_import_failed(database_engine, run_id, error)
        raise
    return ImportSummary(dataset.rows_read, len(dataset.records), dataset.duplicate_rows, False)


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
                if key := normalize_key(value):
                    self.codes[key].add(store.id)
            if key := normalize_key(store.erp_code):
                self.erp_codes[key].add(store.id)
            for value in (store.name, store.legal_name):
                if key := normalize_key(value):
                    self.names[key].add(store.id)

    def resolve(self, reference: str, label: str) -> tuple[uuid.UUID | None, str, str | None]:
        candidate_sets: list[set[uuid.UUID]] = []
        methods: list[str] = []
        reference_key = normalize_key(reference)
        if matches := self.codes.get(reference_key):
            candidate_sets.append(matches)
            methods.append("code")
        for key in {reference_key, normalize_key(label)}:
            if matches := self.names.get(key):
                candidate_sets.append(matches)
                methods.append("name")
            alias_matches = set().union(
                *(self.erp_codes.get(target, set()) for target in self.aliases.get(key, set()))
            )
            if alias_matches:
                candidate_sets.append(alias_matches)
                methods.append("alias")
        if not candidate_sets:
            return None, "unresolved", None
        intersection = set.intersection(*candidate_sets)
        union = set.union(*candidate_sets)
        resolved = intersection if len(intersection) == 1 else union if len(union) == 1 else set()
        method = "+".join(sorted(set(methods)))
        if len(resolved) == 1:
            return next(iter(resolved)), "matched", method
        return None, "conflict", method


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[tuple[list[str], list[str]]] = []
        self.headers: list[str] = []
        self.values: list[str] = []
        self.cell: str | None = None
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        tag = tag.lower()
        if tag == "tr":
            self.headers, self.values = [], []
        elif tag in {"th", "td"}:
            self.cell, self.parts = tag, []

    def handle_data(self, data: str) -> None:
        if self.cell:
            self.parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"th", "td"} and self.cell == tag:
            target = self.headers if tag == "th" else self.values
            target.append(clean_text("".join(self.parts)))
            self.cell, self.parts = None, []
        elif tag == "tr" and (self.headers or self.values):
            self.rows.append((self.headers.copy(), self.values.copy()))


def _read_monthly_rows(path: Path) -> list[tuple[str, str, Decimal, Decimal]]:
    raw = path.read_bytes()
    if path.suffix.lower() == ".csv":
        return _read_csv_rows(raw)
    return _read_html_rows(raw)


def _read_html_rows(raw: bytes) -> list[tuple[str, str, Decimal, Decimal]]:
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ShelfShareSourceError(
            "A shelf share HTML file has an unsupported encoding"
        ) from error
    parser = _TableParser()
    parser.feed(content)
    result: list[tuple[str, str, Decimal, Decimal]] = []
    for row_number, (headers, values) in enumerate(parser.rows, start=1):
        if not headers or not values:
            continue
        if len(headers) != 1 or len(values) != 2:
            raise ShelfShareSourceError(
                f"Shelf share HTML row {row_number} has an unexpected shape"
            )
        label = headers[0]
        groups = re.findall(r"\[([^\[\]]+)\]", label)
        if not groups or not groups[-1].split():
            raise ShelfShareSourceError(f"Shelf share HTML row {row_number} has no store reference")
        reference = clean_text(groups[-1].split()[-1])
        result.append(
            (
                label,
                reference,
                _parse_measure(values[0], "company", row_number),
                _parse_measure(values[1], "total", row_number),
            )
        )
    if not result:
        raise ShelfShareSourceError("A shelf share HTML file contains no data rows")
    return result


def _read_csv_rows(raw: bytes) -> list[tuple[str, str, Decimal, Decimal]]:
    encoding = "utf-16" if raw[:2] in {b"\xff\xfe", b"\xfe\xff"} else "utf-8-sig"
    try:
        content = raw.decode(encoding)
    except UnicodeDecodeError:
        try:
            content = raw.decode("cp1252")
        except UnicodeDecodeError as error:
            raise ShelfShareSourceError(
                "A shelf share CSV file has an unsupported encoding"
            ) from error
    rows = [row for row in csv.reader(content.splitlines()) if any(clean_text(v) for v in row)]
    if not rows:
        raise ShelfShareSourceError("A shelf share CSV file is empty")
    headers = [normalize_header(value) for value in rows[0]]
    while headers and not headers[-1]:
        headers.pop()
    if tuple(headers) != ("client", "societe", "total"):
        raise ShelfShareSourceError("A shelf share CSV file has an unexpected contract")
    result: list[tuple[str, str, Decimal, Decimal]] = []
    for row_number, raw_values in enumerate(rows[1:], start=2):
        values = [clean_text(value) for value in raw_values]
        while len(values) > len(headers) and not values[-1]:
            values.pop()
        if len(values) != len(headers):
            raise ShelfShareSourceError(f"Shelf share CSV row {row_number} has an unexpected width")
        label = values[0]
        result.append(
            (
                label,
                label,
                _parse_measure(values[1], "company", row_number),
                _parse_measure(values[2], "total", row_number),
            )
        )
    if not result:
        raise ShelfShareSourceError("A shelf share CSV file contains no data rows")
    return result


def _parse_measure(raw: str, role: str, row_number: int) -> Decimal:
    normalized = clean_text(raw).replace("\u00a0", "").replace(" ", "").replace(",", ".")
    try:
        number = Decimal(normalized)
    except InvalidOperation as error:
        raise ShelfShareSourceError(
            f"Shelf share row {row_number} has an invalid {role} value"
        ) from error
    exponent = number.as_tuple().exponent
    if not number.is_finite() or number < 0 or not isinstance(exponent, int) or exponent < -2:
        raise ShelfShareSourceError(f"Shelf share row {row_number} has an invalid {role} value")
    return number


def _read_store_aliases(path: Path) -> dict[str, set[str]]:
    raw = path.read_bytes()
    encoding = "utf-16" if raw[:2] in {b"\xff\xfe", b"\xfe\xff"} else "utf-8-sig"
    try:
        content = raw.decode(encoding)
    except UnicodeDecodeError as error:
        raise ShelfShareSourceError("Alias source has an unsupported encoding") from error
    rows = [row for row in csv.reader(content.splitlines()) if any(clean_text(v) for v in row)]
    if not rows:
        raise ShelfShareSourceError("Alias source is empty")
    headers = [normalize_header(value) for value in rows[0]]
    if tuple(headers) != ALIAS_COLUMNS:
        raise ShelfShareSourceError("Alias source has an unexpected contract")
    aliases: dict[str, set[str]] = defaultdict(set)
    for row_number, values in enumerate(rows[1:], start=2):
        if len(values) != len(headers):
            raise ShelfShareSourceError(f"Alias row {row_number} has an unexpected width")
        row = dict(zip(headers, values, strict=True))
        if normalize_key(row["category"]) != "CLIENT":
            continue
        target = normalize_key(row[ALIAS_COLUMNS[-1]])
        if not target:
            continue
        for field in ("raw_values", "normalized_id"):
            if alias := normalize_key(row[field]):
                aliases[alias].add(target)
    return dict(aliases)


def _month_from_name(name: str) -> date:
    match = re.match(r"^(\d{4})(\d{2})", name)
    if match is None:
        raise ShelfShareSourceError("Monthly shelf share filename must start with YYYYMM")
    try:
        return date(int(match.group(1)), int(match.group(2)), 1)
    except ValueError as error:
        raise ShelfShareSourceError("Monthly shelf share filename has an invalid month") from error


def _validate_monthly_file(path: Path) -> None:
    if not path.is_file() or path.suffix.lower() not in {".xls", ".csv"}:
        raise ShelfShareSourceError("Shelf share sources must be existing XLS or CSV files")
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise ShelfShareSourceError("A shelf share source exceeds the 10 MB limit")
    prefix = path.read_bytes()[:512].lstrip().lower()
    if path.suffix.lower() == ".xls" and not (prefix.startswith(b"<") and b"html" in prefix):
        raise ShelfShareSourceError("An XLS shelf share source is not an HTML table")


def _update_digest(digest: Any, path: Path) -> None:
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)


def _publish_shelf_share(engine: Engine, run_id: uuid.UUID, dataset: ShelfShareDataset) -> None:
    with Session(engine) as session, session.begin():
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:dataset))"),
            {"dataset": DATASET},
        )
        session.execute(select(ImportRun.id).where(ImportRun.id == run_id).with_for_update())
        session.execute(delete(ShelfShareObservation))
        for offset in range(0, len(dataset.records), DATABASE_BATCH_SIZE):
            session.execute(
                insert(ShelfShareObservation),
                [
                    asdict(record)
                    for record in dataset.records[offset : offset + DATABASE_BATCH_SIZE]
                ],
            )
        session.execute(
            update(ImportRun)
            .where(ImportRun.id == run_id)
            .values(
                status=ImportStatus.SUCCEEDED.value,
                rows_read=dataset.rows_read,
                rows_inserted=len(dataset.records),
                rows_rejected=dataset.duplicate_rows,
                completed_at=datetime.now(UTC),
            )
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
