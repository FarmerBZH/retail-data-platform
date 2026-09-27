from __future__ import annotations

import csv
import hashlib
import io
import re
import unicodedata
import uuid
from collections import defaultdict
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, delete, select, text, update
from sqlalchemy.orm import Session

from retail_data_platform.database.models import (
    ImportRun,
    ImportStatus,
    Product,
    RegisterObservation,
    Store,
)
from retail_data_platform.database.session import create_database_engine

DATASET = "register"
SOURCE_BUNDLE_NAME = "monthly register and supplementary source bundle"
IMPORT_CONTRACT_VERSION = "1"
MAX_SOURCE_BYTES = 50_000_000
UUID_NAMESPACE = uuid.UUID("12d4d946-5a47-408e-a6ea-0b47cffcb6d9")
GTIN_PATTERN = re.compile(r"(?:\d{8}|\d{12,14})\Z")
MONTH_PATTERN = re.compile(r"(?<!\d)(20\d{4})(?!\d)")
MONTHLY_COLUMNS = (
    "mois_annee",
    "mois",
    "annee",
    "magasin",
    "magasin_libelle",
    "region",
    "departement",
    "ville",
    "vocation",
    "tranche_de_surface",
    "ean",
    "ean_libelle",
    "ca_total",
    "ca_total_evolution",
    "uvc_total",
    "uvc_total_evolution",
    "prix_moyen",
    "prix_moyen_evolution",
)
MONTHLY_RECENT_COLUMNS = (
    "magasin_id",
    "magasin",
    "region",
    "departement",
    "ville",
    "vocation",
    "vocation_surface",
    "ean",
    "libelle_ean",
    "marque",
    "ca",
    "ca_evolution",
    "quantite_uvc",
    "quantite_uvc_evolution",
    "prix_moyen",
    "prix_moyen_evolution",
    "volume_kg_l",
    "volume_kg_l_evolution",
)
SUPPLEMENT_COLUMNS = (
    "mois_annee",
    "id_tdlinx",
    "id_merval",
    "enseigne",
    "marque",
    "famille",
    "ean",
    "ca",
    "uvc",
)
COPY_COLUMNS = (
    "id",
    "period",
    "source_kind",
    "source_store_reference",
    "source_store_secondary_reference",
    "source_store_label",
    "store_id",
    "store_match_status",
    "store_match_method",
    "source_gtin",
    "source_product_label",
    "source_brand",
    "source_family",
    "product_id",
    "product_match_status",
    "revenue_value",
    "revenue_change_ratio",
    "units_sold",
    "units_change_ratio",
    "average_unit_price",
    "average_price_change_ratio",
    "volume_value",
    "volume_change_ratio",
)
COPY_SQL = f"COPY register_observations ({', '.join(COPY_COLUMNS)}) FROM STDIN"


class RegisterSourceError(ValueError):
    """Raised for a malformed or ambiguous register source without echoing private values."""


@dataclass(frozen=True, slots=True)
class SourceFile:
    path: Path
    kind: str
    period: date | None
    columns: tuple[str, ...]
    delimiter: str


@dataclass(frozen=True, slots=True)
class SourceBundle:
    monthly: tuple[SourceFile, ...]
    supplement: SourceFile


@dataclass(frozen=True, slots=True)
class StoreIdentity:
    id: uuid.UUID
    data_sharing_code: str | None
    retail_panel_code: str | None
    legacy_store_id: str | None


@dataclass(frozen=True, slots=True)
class RegisterRecord:
    id: uuid.UUID
    period: date
    source_kind: str
    source_store_reference: str
    source_store_secondary_reference: str | None
    source_store_label: str | None
    store_id: uuid.UUID | None
    store_match_status: str
    store_match_method: str | None
    source_gtin: str
    source_product_label: str | None
    source_brand: str | None
    source_family: str | None
    product_id: uuid.UUID | None
    product_match_status: str
    revenue_value: Decimal | None
    revenue_change_ratio: Decimal | None
    units_sold: int | None
    units_change_ratio: Decimal | None
    average_unit_price: Decimal | None
    average_price_change_ratio: Decimal | None
    volume_value: Decimal | None
    volume_change_ratio: Decimal | None

    def as_copy_row(self) -> tuple[object, ...]:
        return tuple(getattr(self, name) for name in COPY_COLUMNS)


@dataclass(frozen=True, slots=True)
class ImportSummary:
    rows_read: int
    rows_loaded: int
    rows_excluded_totals: int
    skipped: bool


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


def _month_from_filename(name: str) -> date | None:
    match = MONTH_PATTERN.search(name)
    if match is None:
        return None
    try:
        return date(int(match.group(1)[:4]), int(match.group(1)[4:]), 1)
    except ValueError as error:
        raise RegisterSourceError(
            "A monthly register source has an invalid filename month"
        ) from error


def _decode_source(path: Path) -> str:
    raw = path.read_bytes()
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp1252")


def _source_header(path: Path) -> tuple[tuple[str, ...], str]:
    # All supported headers are ASCII-compatible, even when data rows use cp1252.
    with path.open("rb") as source:
        first = source.readline(4096)
    if len(first) == 4096 and b"\n" not in first:
        raise RegisterSourceError("A register source header exceeds the size limit")
    line = first.decode("utf-8-sig", errors="replace")
    delimiter = ";" if line.count(";") > line.count(",") else ","
    columns = tuple(
        normalize_header(value) for value in next(csv.reader([line], delimiter=delimiter))
    )
    return columns, delimiter


def discover_register_sources(source_directory: Path) -> SourceBundle:
    if not source_directory.is_dir():
        raise RegisterSourceError("Register source must be an existing directory")
    monthly: list[SourceFile] = []
    supplements: list[SourceFile] = []
    seen_months: set[date] = set()
    for path in sorted(source_directory.iterdir()):
        if path.name == ".DS_Store":
            continue
        if not path.is_file() or path.suffix.lower() != ".csv":
            raise RegisterSourceError("Register source contains an unsupported file")
        if not 0 < path.stat().st_size <= MAX_SOURCE_BYTES:
            raise RegisterSourceError("A register CSV is empty or exceeds the 50 MB limit")
        columns, delimiter = _source_header(path)
        if columns == SUPPLEMENT_COLUMNS and delimiter == ",":
            supplements.append(SourceFile(path, "supplement", None, columns, delimiter))
        elif columns in {MONTHLY_COLUMNS, MONTHLY_RECENT_COLUMNS} and delimiter == ";":
            period = _month_from_filename(path.name)
            if period is None or period in seen_months:
                raise RegisterSourceError("Monthly register files need unique YYYYMM partitions")
            seen_months.add(period)
            monthly.append(SourceFile(path, "monthly", period, columns, delimiter))
        else:
            raise RegisterSourceError("A register CSV has an unexpected header contract")
    if not monthly or len(supplements) != 1:
        raise RegisterSourceError("Register bundle needs monthly files and one supplement")
    ordered_months = sorted(seen_months)
    for before, after in zip(ordered_months, ordered_months[1:], strict=False):
        next_year, next_month = (
            (before.year + 1, 1) if before.month == 12 else (before.year, before.month + 1)
        )
        if after != date(next_year, next_month, 1):
            raise RegisterSourceError("Monthly register partitions have a gap")
    return SourceBundle(
        tuple(sorted(monthly, key=lambda source: source.period or date.min)), supplements[0]
    )


def source_bundle_sha256(bundle: SourceBundle) -> str:
    digest = hashlib.sha256(f"{DATASET}:{IMPORT_CONTRACT_VERSION}".encode())
    for source in (*bundle.monthly, bundle.supplement):
        digest.update(f"{source.kind}:{source.period}:{source.columns}".encode())
        with source.path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


class _StoreResolver:
    def __init__(self, stores: list[StoreIdentity]) -> None:
        self.sharing: dict[str, set[uuid.UUID]] = defaultdict(set)
        self.panel: dict[str, set[uuid.UUID]] = defaultdict(set)
        self.legacy: dict[str, set[uuid.UUID]] = defaultdict(set)
        for store in stores:
            for mapping, value in (
                (self.sharing, store.data_sharing_code),
                (self.panel, store.retail_panel_code),
                (self.legacy, store.legacy_store_id),
            ):
                if key := normalize_key(value):
                    mapping[key].add(store.id)

    def resolve(
        self, kind: str, primary: str, secondary: str | None
    ) -> tuple[uuid.UUID | None, str, str | None]:
        candidates: list[set[uuid.UUID]] = []
        methods: list[str] = []
        if kind == "monthly":
            if matches := self.sharing.get(normalize_key(primary)):
                candidates.append(matches)
                methods.append("data_sharing_code")
        else:
            if matches := self.panel.get(normalize_key(primary)):
                candidates.append(matches)
                methods.append("retail_panel_code")
            if matches := self.legacy.get(normalize_key(secondary)):
                candidates.append(matches)
                methods.append("legacy_store_id")
        if not candidates:
            return None, "unresolved", None
        intersection = set.intersection(*candidates)
        union = set.union(*candidates)
        resolved = intersection if len(intersection) == 1 else union if len(union) == 1 else set()
        method = "+".join(sorted(methods))
        if len(resolved) == 1:
            return next(iter(resolved)), "matched", method
        return None, "conflict", method


def _optional_text(row: dict[str, str], field: str, limit: int, line: int) -> str | None:
    value = clean_text(row.get(field))
    if len(value) > limit:
        raise RegisterSourceError(f"Register row {line} has an oversized {field} field")
    return value or None


def _measure(
    row: dict[str, str], field: str, scale: int, line: int, *, integer: bool = False
) -> Decimal | int | None:
    raw = clean_text(row.get(field))
    if not raw:
        return None
    normalized = raw.replace("\u00a0", "").replace(" ", "").replace(",", ".")
    try:
        number = Decimal(normalized)
    except InvalidOperation as error:
        raise RegisterSourceError(f"Register row {line} has an invalid {field} value") from error
    if not number.is_finite():
        raise RegisterSourceError(f"Register row {line} has an invalid {field} value")
    if integer:
        if number != number.to_integral_value() or abs(number) > 9_000_000_000_000_000_000:
            raise RegisterSourceError(f"Register row {line} has an invalid {field} integer")
        return int(number)
    quantized = number.quantize(Decimal(1).scaleb(-scale), rounding=ROUND_HALF_UP)
    if abs(quantized) >= Decimal(10) ** (20 - scale):
        raise RegisterSourceError(f"Register row {line} has an out-of-range {field} value")
    return quantized


def _decimal_measure(row: dict[str, str], field: str, scale: int, line: int) -> Decimal | None:
    value = _measure(row, field, scale, line)
    assert value is None or isinstance(value, Decimal)
    return value


def _row_period(row: dict[str, str], source: SourceFile, line: int) -> date:
    if source.kind == "supplement":
        raw = clean_text(row["mois_annee"])
        match = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", raw)
        if match is None:
            raise RegisterSourceError(f"Supplement row {line} has an invalid period")
        try:
            parsed = date(int(match.group(3)), int(match.group(2)), int(match.group(1)))
        except ValueError as error:
            raise RegisterSourceError(f"Supplement row {line} has an invalid period") from error
        if parsed.day != 1:
            raise RegisterSourceError(f"Supplement row {line} does not use a monthly period")
        return parsed
    assert source.period is not None
    if source.columns == MONTHLY_COLUMNS:
        try:
            parsed = date.fromisoformat(clean_text(row["mois_annee"]))
        except ValueError as error:
            raise RegisterSourceError(f"Monthly row {line} has an invalid period") from error
        if parsed != source.period or clean_text(row["annee"]) != str(source.period.year):
            raise RegisterSourceError(f"Monthly row {line} disagrees with its file period")
    return source.period


def _iter_source_rows(source: SourceFile) -> Iterator[tuple[int, dict[str, str]]]:
    content = _decode_source(source.path)
    reader = csv.reader(io.StringIO(content), delimiter=source.delimiter)
    header = next(reader, None)
    if header is None or tuple(normalize_header(value) for value in header) != source.columns:
        raise RegisterSourceError("A register source header changed during import")
    for line, values in enumerate(reader, start=2):
        if not values:
            continue
        if len(values) != len(source.columns):
            raise RegisterSourceError(f"Register row {line} has an unexpected width")
        yield line, dict(zip(source.columns, values, strict=True))


def _record_from_row(
    row: dict[str, str],
    source: SourceFile,
    line: int,
    stores: _StoreResolver,
    products: dict[str, uuid.UUID],
) -> RegisterRecord | None:
    period = _row_period(row, source, line)
    if source.kind == "supplement":
        primary_field, secondary_field = "id_tdlinx", "id_merval"
        product_label_field = None
        revenue_field, units_field = "ca", "uvc"
    elif source.columns == MONTHLY_RECENT_COLUMNS:
        primary_field, secondary_field = "magasin_id", None
        product_label_field = "libelle_ean"
        revenue_field, units_field = "ca", "quantite_uvc"
    else:
        primary_field, secondary_field = "magasin", None
        product_label_field = "ean_libelle"
        revenue_field, units_field = "ca_total", "uvc_total"
    primary = clean_text(row[primary_field])
    secondary = clean_text(row[secondary_field]) if secondary_field else None
    gtin = clean_text(row["ean"])
    if normalize_key(primary) == "TOTAL" or normalize_key(gtin) == "TOTAL":
        return None
    if not primary or len(primary) > 64 or secondary is not None and len(secondary) > 64:
        raise RegisterSourceError(f"Register row {line} has an invalid store reference")
    if not GTIN_PATTERN.fullmatch(gtin):
        raise RegisterSourceError(f"Register row {line} has an invalid product GTIN")
    store_id, store_status, store_method = stores.resolve(source.kind, primary, secondary)
    product_id = products.get(gtin)
    identity = (
        f"{source.kind}|{period.isoformat()}|{normalize_key(primary)}|"
        f"{normalize_key(secondary)}|{gtin}"
    )
    is_recent = source.columns == MONTHLY_RECENT_COLUMNS
    is_classic = source.columns == MONTHLY_COLUMNS
    revenue = _decimal_measure(row, revenue_field, 2, line)
    units = _measure(row, units_field, 0, line, integer=True)
    assert units is None or isinstance(units, int)
    return RegisterRecord(
        id=uuid.uuid5(UUID_NAMESPACE, identity),
        period=period,
        source_kind=source.kind,
        source_store_reference=primary,
        source_store_secondary_reference=secondary,
        source_store_label=_optional_text(row, "magasin_libelle", 255, line)
        if is_classic
        else (_optional_text(row, "magasin", 255, line) if is_recent else None),
        store_id=store_id,
        store_match_status=store_status,
        store_match_method=store_method,
        source_gtin=gtin,
        source_product_label=_optional_text(row, product_label_field, 255, line)
        if product_label_field
        else None,
        source_brand=_optional_text(row, "marque", 128, line),
        source_family=_optional_text(row, "famille", 128, line),
        product_id=product_id,
        product_match_status="matched" if product_id else "unresolved",
        revenue_value=revenue,
        revenue_change_ratio=_decimal_measure(
            row, "ca_evolution" if is_recent else "ca_total_evolution", 8, line
        )
        if source.kind == "monthly"
        else None,
        units_sold=units,
        units_change_ratio=_decimal_measure(
            row, "quantite_uvc_evolution" if is_recent else "uvc_total_evolution", 8, line
        )
        if source.kind == "monthly"
        else None,
        average_unit_price=_decimal_measure(row, "prix_moyen", 6, line),
        average_price_change_ratio=_decimal_measure(row, "prix_moyen_evolution", 8, line),
        volume_value=_decimal_measure(row, "volume_kg_l", 6, line) if is_recent else None,
        volume_change_ratio=_decimal_measure(row, "volume_kg_l_evolution", 8, line)
        if is_recent
        else None,
    )


def _iter_source_records(
    source: SourceFile, stores: _StoreResolver, products: dict[str, uuid.UUID]
) -> Iterator[RegisterRecord | None]:
    seen: set[uuid.UUID] = set()
    for line, row in _iter_source_rows(source):
        record = _record_from_row(row, source, line, stores, products)
        if record is not None:
            if record.id in seen:
                raise RegisterSourceError(
                    f"Register row {line} duplicates a source business identity"
                )
            seen.add(record.id)
        yield record


def import_register(source_directory: Path, engine: Engine | None = None) -> ImportSummary:
    bundle = discover_register_sources(source_directory)
    database_engine = engine or create_database_engine()
    checksum = source_bundle_sha256(bundle)
    with Session(database_engine) as session:
        existing = session.scalar(
            select(ImportRun.id).where(
                ImportRun.dataset == DATASET,
                ImportRun.source_sha256 == checksum,
                ImportRun.status == ImportStatus.SUCCEEDED.value,
            )
        )
        if existing is not None:
            return ImportSummary(0, 0, 0, True)
        stores = [
            StoreIdentity(*row)
            for row in session.execute(
                select(
                    Store.id,
                    Store.data_sharing_code,
                    Store.retail_panel_code,
                    Store.legacy_store_id,
                )
            ).all()
        ]
        products: dict[str, uuid.UUID] = {
            gtin: product_id
            for gtin, product_id in session.execute(select(Product.gtin, Product.id))
        }
        if not stores or not products:
            raise RegisterSourceError("Stores and products must be imported before register")
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
    resolver = _StoreResolver(stores)
    rows_read = 0
    rows_loaded = 0
    excluded_totals = 0
    try:
        with database_engine.connect() as connection, connection.begin():
            connection.execute(
                text("SELECT pg_advisory_xact_lock(hashtext(:dataset))"), {"dataset": DATASET}
            )
            connection.execute(select(ImportRun.id).where(ImportRun.id == run_id).with_for_update())
            connection.execute(delete(RegisterObservation))
            driver: Any = connection.connection.driver_connection
            with driver.cursor() as cursor, cursor.copy(COPY_SQL) as copy:
                for source in (*bundle.monthly, bundle.supplement):
                    for record in _iter_source_records(source, resolver, products):
                        rows_read += 1
                        if record is None:
                            excluded_totals += 1
                            continue
                        copy.write_row(record.as_copy_row())
                        rows_loaded += 1
            connection.execute(
                update(ImportRun)
                .where(ImportRun.id == run_id)
                .values(
                    status=ImportStatus.SUCCEEDED.value,
                    rows_read=rows_read,
                    rows_inserted=rows_loaded,
                    rows_rejected=excluded_totals,
                    completed_at=datetime.now(UTC),
                )
            )
    except Exception as error:
        with Session(database_engine) as session, session.begin():
            session.execute(
                update(ImportRun)
                .where(ImportRun.id == run_id)
                .values(
                    status=ImportStatus.FAILED.value,
                    error_message=str(error)[:2000]
                    if isinstance(error, RegisterSourceError)
                    else "Register publication failed",
                    completed_at=datetime.now(UTC),
                )
            )
        raise
    return ImportSummary(rows_read, rows_loaded, excluded_totals, False)
