from __future__ import annotations

import csv
import hashlib
import re
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import Engine, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from retail_data_platform.database.models import ImportRun, ImportStatus, Store
from retail_data_platform.database.session import create_database_engine

DATASET = "stores"
SOURCE_BUNDLE_NAME = "store source bundle"
MAX_SOURCE_BYTES = 5_000_000
DATABASE_BATCH_SIZE = 500
IDENTITY_COLUMNS = (
    "codegnx",
    "code_coheris",
    "code_sap",
    "id_merval",
    "tdlinx",
    "nom_magasin",
)
ANNUAL_COLUMNS = (*IDENTITY_COLUMNS, "catp_2025", "catp_2024", "catp_2023")
HISTORICAL_COLUMNS = ("tdlinx", "catp_m_octobre_2023")
LISTING_REQUIRED_COLUMNS = {
    *IDENTITY_COLUMNS,
    "raison_sociale",
    "adresse",
    "complement",
    "dept",
    "cp",
    "ville",
    "dr",
    "nom_dr",
    "cds",
    "nom_cds",
    "pmt",
    "nom_pmt",
    "secon2",
    "nom_secon2",
    "ens_cod_famille_de_tiers",
    "enseigne_coheris",
    "type_magasin_nielsen",
    "catp_m",
    "surface_de_vente_m2",
    "classification",
    "segmentation",
    "type_direct",
    "potentiel_direct",
    "date_validite_releve_coheris",
    "nb_de_visite_theorique_cds",
    "temps_min_par_visite_cds",
    "nb_de_visite_theorique_prom",
    "temps_min_par_visite_prom",
    "somme_visite_theorique_cds_prom",
    "nb_total_de_caisses",
    "code_interne_datasharing_enseigne",
}
NULL_MARKERS = {"", "-", "#N/A", "#REF!", "#VALUE!", "#DIV/0!"}


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    row_number: int
    field: str
    message: str


@dataclass(frozen=True, slots=True)
class StoreRecord:
    source_key: str
    external_network_code: str | None
    crm_code: str | None
    erp_code: str | None
    legacy_store_id: str | None
    retail_panel_code: str | None
    data_sharing_code: str | None
    name: str | None
    legal_name: str | None
    address_line_1: str | None
    address_line_2: str | None
    department_code: str | None
    postal_code: str | None
    city: str | None
    retailer_code: str | None
    retailer_name: str | None
    store_format: str | None
    region_code: str | None
    region_name: str | None
    sales_representative_code: str | None
    sales_representative_name: str | None
    promoter_code: str | None
    promoter_name: str | None
    secondary_representative_code: str | None
    secondary_representative_name: str | None
    sales_area_sqm: int | None
    classification: str | None
    segmentation: str | None
    distribution_model: str | None
    has_direct_sales_potential: bool | None
    survey_validity_days: int | None
    planned_sales_visits: int | None
    sales_visit_minutes: int | None
    planned_promoter_visits: int | None
    promoter_visit_minutes: int | None
    planned_total_visits: int | None
    checkout_count: int | None
    annual_turnover_2025_millions: Decimal | None
    annual_turnover_2024_millions: Decimal | None
    annual_turnover_2023_millions: Decimal | None
    october_2023_turnover_millions: Decimal | None


@dataclass(frozen=True, slots=True)
class StoreSources:
    listing: Path
    annual_turnover: Path
    historical_turnover: Path


@dataclass(frozen=True, slots=True)
class StoreDataset:
    records: tuple[StoreRecord, ...]
    rows_read: int


@dataclass(frozen=True, slots=True)
class ImportSummary:
    rows_read: int
    rows_loaded: int
    skipped: bool


class StoreSourceError(ValueError):
    """Raised when the store sources cannot be safely processed."""


class StoreSourceValidationError(StoreSourceError):
    def __init__(self, issues: list[ValidationIssue], rows_read: int) -> None:
        self.issues = tuple(issues)
        self.rows_read = rows_read
        preview = "; ".join(
            f"row {issue.row_number}, {issue.field}: {issue.message}" for issue in issues[:10]
        )
        remaining = len(issues) - 10
        suffix = f"; {remaining} more issue(s)" if remaining > 0 else ""
        super().__init__(f"Store source validation failed: {preview}{suffix}")


def normalize_header(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", errors="ignore")
        .decode("ascii")
        .lower()
    )
    return re.sub(r"[^a-z0-9]+", "_", ascii_value).strip("_")


def clean_text(value: str | None) -> str:
    if value is None:
        return ""
    return (
        unicodedata.normalize("NFKC", value)
        .replace("\ufeff", "")
        .replace("\u200b", "")
        .replace("\u202f", " ")
        .strip()
    )


def optional_text(value: str | None) -> str | None:
    cleaned = clean_text(value)
    if cleaned.upper() in NULL_MARKERS or not cleaned.strip("- "):
        return None
    return cleaned


def discover_store_sources(source_directory: Path) -> StoreSources:
    if not source_directory.is_dir():
        raise StoreSourceError("Store source must be an existing directory")
    matches: dict[str, list[Path]] = {
        "listing": [],
        "annual_turnover": [],
        "historical_turnover": [],
    }
    csv_files = sorted(source_directory.glob("*.csv"))
    if not csv_files:
        raise StoreSourceError("Store source directory contains no CSV files")

    for source_path in csv_files:
        _validate_source_file(source_path)
        first_row, second_row = _read_first_rows(source_path)
        first_headers = tuple(normalize_header(value) for value in first_row)
        second_headers = tuple(normalize_header(value) for value in second_row)
        if first_headers == HISTORICAL_COLUMNS:
            matches["historical_turnover"].append(source_path)
        elif second_headers == ANNUAL_COLUMNS:
            matches["annual_turnover"].append(source_path)
        elif second_headers[
            : len(IDENTITY_COLUMNS)
        ] == IDENTITY_COLUMNS and LISTING_REQUIRED_COLUMNS.issubset(second_headers):
            matches["listing"].append(source_path)
        else:
            raise StoreSourceError("A CSV file does not match a supported store source contract")

    for role, paths in matches.items():
        if len(paths) != 1:
            raise StoreSourceError(f"Store source directory must contain exactly one {role} CSV")
    return StoreSources(
        listing=matches["listing"][0],
        annual_turnover=matches["annual_turnover"][0],
        historical_turnover=matches["historical_turnover"][0],
    )


def source_bundle_sha256(sources: StoreSources) -> str:
    digest = hashlib.sha256()
    for role in ("listing", "annual_turnover", "historical_turnover"):
        digest.update(role.encode())
        with getattr(sources, role).open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def read_store_records(source_directory: Path) -> list[StoreRecord]:
    return list(_read_store_dataset(discover_store_sources(source_directory)).records)


def import_stores(source_directory: Path, engine: Engine | None = None) -> ImportSummary:
    sources = discover_store_sources(source_directory)
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

    rows_read = 0
    try:
        dataset = _read_store_dataset(sources)
        rows_read = dataset.rows_read
        _publish_stores(database_engine, run_id, list(dataset.records), rows_read)
    except Exception as error:
        rejected = (
            len({issue.row_number for issue in error.issues})
            if isinstance(error, StoreSourceValidationError)
            else 0
        )
        failed_rows_read = (
            error.rows_read if isinstance(error, StoreSourceValidationError) else rows_read
        )
        _mark_import_failed(database_engine, run_id, error, failed_rows_read, rejected)
        raise
    return ImportSummary(rows_read=rows_read, rows_loaded=len(dataset.records), skipped=False)


def _read_store_dataset(sources: StoreSources) -> StoreDataset:
    listing_records, listing_rows = _read_listing(sources.listing)
    annual_records, annual_rows = _read_annual_turnover(sources.annual_turnover)
    historical_records, historical_rows = _read_historical_turnover(sources.historical_turnover)

    merged = {record.source_key: record for record in listing_records}
    for annual in annual_records:
        existing = merged.get(annual.source_key)
        if existing is None:
            merged[annual.source_key] = annual
            continue
        _validate_identity_match(existing, annual)
        if (
            existing.annual_turnover_2025_millions is not None
            and annual.annual_turnover_2025_millions is not None
            and existing.annual_turnover_2025_millions != annual.annual_turnover_2025_millions
        ):
            raise StoreSourceError("The two store sources disagree on 2025 turnover")
        merged[annual.source_key] = replace(
            existing,
            annual_turnover_2025_millions=(
                existing.annual_turnover_2025_millions
                if existing.annual_turnover_2025_millions is not None
                else annual.annual_turnover_2025_millions
            ),
            annual_turnover_2024_millions=annual.annual_turnover_2024_millions,
            annual_turnover_2023_millions=annual.annual_turnover_2023_millions,
        )

    by_panel: dict[str, list[str]] = defaultdict(list)
    for source_key, record in merged.items():
        if record.retail_panel_code:
            by_panel[record.retail_panel_code].append(source_key)
    for panel_code, turnover in historical_records:
        matches = by_panel.get(panel_code, [])
        if len(matches) > 1:
            raise StoreSourceError("Historical turnover matches more than one store")
        if matches:
            key = matches[0]
            merged[key] = replace(merged[key], october_2023_turnover_millions=turnover)
        else:
            key = f"retail_panel:{panel_code}"
            merged[key] = _partial_store(key, panel_code, turnover)

    records = list(merged.values())
    _validate_unique_records(records)
    return StoreDataset(
        records=tuple(records),
        rows_read=listing_rows + annual_rows + historical_rows,
    )


def _read_listing(source_path: Path) -> tuple[list[StoreRecord], int]:
    headers, rows = _read_rows(source_path, header_index=1, source_name="Store listing")
    _validate_required_headers(headers, LISTING_REQUIRED_COLUMNS, "Store listing")
    records_with_rows: list[tuple[int, StoreRecord]] = []
    issues: list[ValidationIssue] = []
    for row_number, values in enumerate(rows, start=3):
        row = _row_dict(headers, values)
        if not any(optional_text(row.get(column)) for column in IDENTITY_COLUMNS):
            continue
        initial_issue_count = len(issues)
        network_code = _required(row, "codegnx", row_number, issues)
        crm_code = _required(row, "code_coheris", row_number, issues)
        erp_code = _required_digits(row, "code_sap", row_number, issues)
        name = _required(row, "nom_magasin", row_number, issues)
        if len(issues) != initial_issue_count:
            continue
        assert network_code and crm_code and erp_code and name
        records_with_rows.append(
            (
                row_number,
                StoreRecord(
                    source_key=f"crm:{crm_code}",
                    external_network_code=network_code,
                    crm_code=crm_code,
                    erp_code=erp_code,
                    legacy_store_id=optional_text(row.get("id_merval")),
                    retail_panel_code=_optional_digits(row, "tdlinx", row_number, issues),
                    data_sharing_code=optional_text(row.get("code_interne_datasharing_enseigne")),
                    name=name,
                    legal_name=optional_text(row.get("raison_sociale")),
                    address_line_1=optional_text(row.get("adresse")),
                    address_line_2=optional_text(row.get("complement")),
                    department_code=optional_text(row.get("dept")),
                    postal_code=optional_text(row.get("cp")),
                    city=optional_text(row.get("ville")),
                    retailer_code=optional_text(row.get("ens_cod_famille_de_tiers")),
                    retailer_name=optional_text(row.get("enseigne_coheris")),
                    store_format=optional_text(row.get("type_magasin_nielsen")),
                    region_code=optional_text(row.get("dr")),
                    region_name=optional_text(row.get("nom_dr")),
                    sales_representative_code=optional_text(row.get("cds")),
                    sales_representative_name=optional_text(row.get("nom_cds")),
                    promoter_code=optional_text(row.get("pmt")),
                    promoter_name=optional_text(row.get("nom_pmt")),
                    secondary_representative_code=optional_text(row.get("secon2")),
                    secondary_representative_name=optional_text(row.get("nom_secon2")),
                    sales_area_sqm=_optional_integer(
                        row, "surface_de_vente_m2", row_number, issues
                    ),
                    classification=optional_text(row.get("classification")),
                    segmentation=optional_text(row.get("segmentation")),
                    distribution_model=optional_text(row.get("type_direct")),
                    has_direct_sales_potential=_optional_yes(
                        row, "potentiel_direct", row_number, issues
                    ),
                    survey_validity_days=_optional_integer(
                        row, "date_validite_releve_coheris", row_number, issues
                    ),
                    planned_sales_visits=_optional_integer(
                        row, "nb_de_visite_theorique_cds", row_number, issues
                    ),
                    sales_visit_minutes=_optional_integer(
                        row, "temps_min_par_visite_cds", row_number, issues
                    ),
                    planned_promoter_visits=_optional_integer(
                        row, "nb_de_visite_theorique_prom", row_number, issues
                    ),
                    promoter_visit_minutes=_optional_integer(
                        row, "temps_min_par_visite_prom", row_number, issues
                    ),
                    planned_total_visits=_optional_integer(
                        row, "somme_visite_theorique_cds_prom", row_number, issues
                    ),
                    checkout_count=_optional_integer(
                        row, "nb_total_de_caisses", row_number, issues
                    ),
                    annual_turnover_2025_millions=_optional_decimal(
                        row, "catp_m", row_number, issues
                    ),
                    annual_turnover_2024_millions=None,
                    annual_turnover_2023_millions=None,
                    october_2023_turnover_millions=None,
                ),
            )
        )
    _append_duplicate_issues(records_with_rows, issues)
    if issues:
        raise StoreSourceValidationError(issues, rows_read=len(records_with_rows))
    if not records_with_rows:
        raise StoreSourceError("Store listing contains no data rows")
    return [record for _, record in records_with_rows], len(records_with_rows)


def _read_annual_turnover(source_path: Path) -> tuple[list[StoreRecord], int]:
    headers, rows = _read_rows(source_path, header_index=1, source_name="Annual turnover")
    if tuple(headers) != ANNUAL_COLUMNS:
        raise StoreSourceError("Annual turnover columns do not match the expected contract")
    records_with_rows: list[tuple[int, StoreRecord]] = []
    issues: list[ValidationIssue] = []
    for row_number, values in enumerate(rows, start=3):
        row = _row_dict(headers, values)
        if not any(optional_text(row.get(column)) for column in IDENTITY_COLUMNS):
            continue
        network_code = _required(row, "codegnx", row_number, issues)
        crm_code = _required(row, "code_coheris", row_number, issues)
        erp_code = _required_digits(row, "code_sap", row_number, issues)
        name = _required(row, "nom_magasin", row_number, issues)
        if not all((network_code, crm_code, erp_code, name)):
            continue
        records_with_rows.append(
            (
                row_number,
                replace(
                    _empty_store(f"crm:{crm_code}"),
                    external_network_code=network_code,
                    crm_code=crm_code,
                    erp_code=erp_code,
                    legacy_store_id=optional_text(row.get("id_merval")),
                    retail_panel_code=_optional_digits(row, "tdlinx", row_number, issues),
                    name=name,
                    annual_turnover_2025_millions=_optional_decimal(
                        row, "catp_2025", row_number, issues, allow_spreadsheet_error=True
                    ),
                    annual_turnover_2024_millions=_optional_decimal(
                        row, "catp_2024", row_number, issues
                    ),
                    annual_turnover_2023_millions=_optional_decimal(
                        row, "catp_2023", row_number, issues
                    ),
                ),
            )
        )
    _append_duplicate_issues(records_with_rows, issues)
    if issues:
        raise StoreSourceValidationError(issues, rows_read=len(records_with_rows))
    if not records_with_rows:
        raise StoreSourceError("Annual turnover contains no data rows")
    return [record for _, record in records_with_rows], len(records_with_rows)


def _read_historical_turnover(source_path: Path) -> tuple[list[tuple[str, Decimal]], int]:
    headers, rows = _read_rows(source_path, header_index=0, source_name="Historical turnover")
    if tuple(headers) != HISTORICAL_COLUMNS:
        raise StoreSourceError("Historical turnover columns do not match the expected contract")
    records: list[tuple[str, Decimal]] = []
    issues: list[ValidationIssue] = []
    seen: set[str] = set()
    for row_number, values in enumerate(rows, start=2):
        row = _row_dict(headers, values)
        panel_code = _required_digits(row, "tdlinx", row_number, issues)
        turnover = _optional_decimal(row, "catp_m_octobre_2023", row_number, issues)
        if turnover is None:
            issues.append(ValidationIssue(row_number, "catp_m_octobre_2023", "is required"))
        if panel_code in seen:
            issues.append(ValidationIssue(row_number, "tdlinx", "is duplicated"))
        if panel_code and turnover is not None:
            seen.add(panel_code)
            records.append((panel_code, turnover))
    if issues:
        raise StoreSourceValidationError(issues, rows_read=len(rows))
    if not records:
        raise StoreSourceError("Historical turnover contains no data rows")
    return records, len(records)


def _empty_store(source_key: str) -> StoreRecord:
    return StoreRecord(
        source_key=source_key,
        **{field: None for field in StoreRecord.__dataclass_fields__ if field != "source_key"},
    )


def _partial_store(source_key: str, panel_code: str, turnover: Decimal) -> StoreRecord:
    return replace(
        _empty_store(source_key),
        retail_panel_code=panel_code,
        october_2023_turnover_millions=turnover,
    )


def _validate_identity_match(current: StoreRecord, incoming: StoreRecord) -> None:
    for field in (
        "external_network_code",
        "crm_code",
        "erp_code",
        "legacy_store_id",
        "retail_panel_code",
        "name",
    ):
        left = getattr(current, field)
        right = getattr(incoming, field)
        if left is not None and right is not None and left != right:
            raise StoreSourceError("Store identity fields disagree between sources")


def _read_rows(
    source_path: Path, *, header_index: int, source_name: str
) -> tuple[list[str], list[list[str]]]:
    try:
        with source_path.open("r", encoding="utf-8-sig", newline="") as source:
            rows = list(csv.reader(source))
    except UnicodeDecodeError as error:
        raise StoreSourceError(f"{source_name} must be valid UTF-8") from error
    if len(rows) <= header_index:
        raise StoreSourceError(f"{source_name} is empty")
    return [normalize_header(value) for value in rows[header_index]], rows[header_index + 1 :]


def _validate_required_headers(headers: list[str], required: set[str], source_name: str) -> None:
    missing = required - set(headers)
    ambiguous = {header for header in required if headers.count(header) > 1}
    if missing or ambiguous:
        raise StoreSourceError(f"{source_name} columns do not match the expected contract")


def _row_dict(headers: list[str], values: list[str]) -> dict[str, str]:
    if len(values) != len(headers):
        raise StoreSourceError("A store source row has an unexpected number of columns")
    return dict(zip(headers, values, strict=True))


def _required(
    row: dict[str, str], field: str, row_number: int, issues: list[ValidationIssue]
) -> str:
    value = optional_text(row.get(field))
    if value is None:
        issues.append(ValidationIssue(row_number, field, "is required"))
        return ""
    return value


def _required_digits(
    row: dict[str, str], field: str, row_number: int, issues: list[ValidationIssue]
) -> str:
    value = _required(row, field, row_number, issues)
    if value and not value.isdigit():
        issues.append(ValidationIssue(row_number, field, "must contain digits only"))
    return value


def _optional_digits(
    row: dict[str, str], field: str, row_number: int, issues: list[ValidationIssue]
) -> str | None:
    value = optional_text(row.get(field))
    if value and not value.isdigit():
        issues.append(ValidationIssue(row_number, field, "must contain digits only"))
        return None
    return value


def _optional_integer(
    row: dict[str, str], field: str, row_number: int, issues: list[ValidationIssue]
) -> int | None:
    value = optional_text(row.get(field))
    if value is None:
        return None
    normalized = value.replace(" ", "")
    if not normalized.isdigit():
        issues.append(ValidationIssue(row_number, field, "must be a non-negative integer"))
        return None
    return int(normalized)


def _optional_decimal(
    row: dict[str, str],
    field: str,
    row_number: int,
    issues: list[ValidationIssue],
    *,
    allow_spreadsheet_error: bool = False,
) -> Decimal | None:
    raw_value = clean_text(row.get(field))
    if allow_spreadsheet_error and raw_value == "#REF!":
        return None
    if raw_value.startswith("#"):
        issues.append(ValidationIssue(row_number, field, "contains a spreadsheet error"))
        return None
    value = optional_text(raw_value)
    if value is None:
        return None
    normalized = value.replace(" ", "").replace(",", ".")
    try:
        number = Decimal(normalized)
    except InvalidOperation:
        issues.append(ValidationIssue(row_number, field, "must be a decimal number"))
        return None
    if not number.is_finite() or number < 0:
        issues.append(ValidationIssue(row_number, field, "must be a finite non-negative number"))
        return None
    return number


def _optional_yes(
    row: dict[str, str], field: str, row_number: int, issues: list[ValidationIssue]
) -> bool | None:
    value = optional_text(row.get(field))
    if value is None:
        return None
    if normalize_header(value) == "oui":
        return True
    issues.append(ValidationIssue(row_number, field, "must be yes or blank"))
    return None


def _append_duplicate_issues(
    records_with_rows: list[tuple[int, StoreRecord]], issues: list[ValidationIssue]
) -> None:
    for field in ("source_key", "external_network_code", "crm_code", "erp_code", "legacy_store_id"):
        seen: set[str] = set()
        for row_number, record in records_with_rows:
            value = getattr(record, field)
            if value and value in seen:
                issues.append(ValidationIssue(row_number, field, "is duplicated in the source"))
            if value:
                seen.add(value)


def _validate_unique_records(records: list[StoreRecord]) -> None:
    issues: list[ValidationIssue] = []
    _append_duplicate_issues(list(enumerate(records, start=1)), issues)
    if issues:
        raise StoreSourceValidationError(issues, rows_read=len(records))


def _validate_source_file(source_path: Path) -> None:
    if not source_path.is_file():
        raise StoreSourceError("Store source must be an existing file")
    if source_path.suffix.lower() != ".csv":
        raise StoreSourceError("Store source must be a CSV file")
    if source_path.stat().st_size > MAX_SOURCE_BYTES:
        raise StoreSourceError("Store source exceeds the 5 MB limit")


def _read_first_rows(source_path: Path) -> tuple[list[str], list[str]]:
    try:
        with source_path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source)
            return next(reader, []), next(reader, [])
    except UnicodeDecodeError as error:
        raise StoreSourceError("Store source must be valid UTF-8") from error


def _publish_stores(
    engine: Engine, run_id: uuid.UUID, records: list[StoreRecord], rows_read: int
) -> None:
    values = [asdict(record) | {"is_active": True} for record in records]
    unique_fields = ("external_network_code", "crm_code", "erp_code", "legacy_store_id")
    with Session(engine) as session, session.begin():
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:dataset))"), {"dataset": DATASET}
        )
        session.execute(update(Store).values(is_active=False, updated_at=func.now()))
        for field in unique_fields:
            incoming_values = [
                getattr(record, field) for record in records if getattr(record, field)
            ]
            if incoming_values:
                column = getattr(Store, field)
                session.execute(
                    update(Store).where(column.in_(incoming_values)).values({field: None})
                )
        for offset in range(0, len(values), DATABASE_BATCH_SIZE):
            statement = insert(Store).values(values[offset : offset + DATABASE_BATCH_SIZE])
            excluded = statement.excluded
            update_fields = {
                field: getattr(excluded, field)
                for field in StoreRecord.__dataclass_fields__
                if field != "source_key"
            }
            update_fields |= {"is_active": True, "updated_at": func.now()}
            session.execute(
                statement.on_conflict_do_update(
                    index_elements=[Store.source_key],
                    set_=update_fields,
                )
            )
        session.execute(
            update(ImportRun)
            .where(ImportRun.id == run_id)
            .values(
                status=ImportStatus.SUCCEEDED.value,
                rows_read=rows_read,
                rows_inserted=len(records),
                rows_rejected=0,
                completed_at=datetime.now(UTC),
            )
        )


def _mark_import_failed(
    engine: Engine,
    run_id: uuid.UUID,
    error: Exception,
    rows_read: int,
    rows_rejected: int,
) -> None:
    with Session(engine) as session, session.begin():
        session.execute(
            update(ImportRun)
            .where(ImportRun.id == run_id)
            .values(
                status=ImportStatus.FAILED.value,
                rows_read=rows_read,
                rows_rejected=rows_rejected,
                error_message=str(error)[:2000],
                completed_at=datetime.now(UTC),
            )
        )
