from __future__ import annotations

import csv
import hashlib
import re
import unicodedata
import uuid
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import Engine, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from retail_data_platform.database.models import ImportRun, ImportStatus, Product
from retail_data_platform.database.session import create_database_engine

DATASET = "products"
SOURCE_BUNDLE_NAME = "product source bundle"
MAX_SOURCE_BYTES = 10_000_000
CATALOG_COLUMNS = (
    "ean",
    "code_sap",
    "code_interne",
    "nom",
    "marque",
    "promo",
    "valeur",
    "unite",
    "marche",
    "categorie",
    "segment",
    "prix_moyen",
    "categorie_court",
)
CATEGORY_MAPPING_COLUMNS = ("categorie", "categorie_court")
REFERENCE_COLUMNS = (
    "libelle_court",
    "ancien_libelle_court",
    "code_sap",
    "ancien_code_sap",
    "code_ean",
    "designation",
    "",
    "",
    "libelle_court",
    "code_sap",
    "code_ean",
    "designation",
)


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    row_number: int
    field: str
    message: str


@dataclass(frozen=True, slots=True)
class ProductRecord:
    gtin: str
    erp_code: str | None
    legacy_erp_code: str | None
    internal_code: str
    legacy_internal_code: str | None
    name: str
    brand: str | None
    market: str | None
    category: str | None
    segment: str | None
    content_quantity: Decimal | None
    content_unit: str | None
    average_price: Decimal | None
    average_price_currency: str | None
    category_code: str | None


@dataclass(frozen=True, slots=True)
class ProductSources:
    catalog: Path
    category_mapping: Path
    reference: Path


@dataclass(frozen=True, slots=True)
class ProductDataset:
    records: tuple[ProductRecord, ...]
    rows_read: int


@dataclass(frozen=True, slots=True)
class ImportSummary:
    rows_read: int
    rows_loaded: int
    skipped: bool


class ProductSourceError(ValueError):
    """Raised when the product sources cannot be safely processed."""


class ProductSourceValidationError(ProductSourceError):
    def __init__(self, issues: list[ValidationIssue], rows_read: int) -> None:
        self.issues = tuple(issues)
        self.rows_read = rows_read
        preview = "; ".join(
            f"row {issue.row_number}, {issue.field}: {issue.message}" for issue in issues[:10]
        )
        remaining = len(issues) - 10
        suffix = f"; {remaining} more issue(s)" if remaining > 0 else ""
        super().__init__(f"Product source validation failed: {preview}{suffix}")


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
    return unicodedata.normalize("NFKC", value).replace("\u200b", "").replace("\ufeff", "").strip()


def is_valid_gtin(value: str) -> bool:
    if not value.isdigit() or len(value) not in {8, 12, 13, 14}:
        return False
    digits = [int(character) for character in value]
    weighted_sum = sum(
        digit * (3 if position % 2 else 1)
        for position, digit in enumerate(reversed(digits[:-1]), start=1)
    )
    return (10 - weighted_sum % 10) % 10 == digits[-1]


def parse_decimal(value: str, *, field: str, row_number: int) -> Decimal:
    normalized = value.replace("\u00a0", "").replace(" ", "").replace(",", ".")
    try:
        number = Decimal(normalized)
    except InvalidOperation as error:
        raise ProductSourceValidationError(
            [ValidationIssue(row_number, field, "must be a decimal number")],
            rows_read=row_number - 1,
        ) from error
    if not number.is_finite() or number < 0:
        raise ProductSourceValidationError(
            [ValidationIssue(row_number, field, "must be a finite non-negative number")],
            rows_read=row_number - 1,
        )
    return number


def discover_product_sources(source_directory: Path) -> ProductSources:
    if not source_directory.is_dir():
        raise ProductSourceError("Product source must be an existing directory")

    matches: dict[str, list[Path]] = {"catalog": [], "category_mapping": [], "reference": []}
    csv_files = sorted(source_directory.glob("*.csv"))
    if not csv_files:
        raise ProductSourceError("Product source directory contains no CSV files")

    for source_path in csv_files:
        _validate_source_file(source_path)
        first_row, second_row = _read_first_rows(source_path)
        first_headers = tuple(normalize_header(value) for value in first_row)
        second_headers = tuple(normalize_header(value) for value in second_row)
        if first_headers == CATALOG_COLUMNS:
            matches["catalog"].append(source_path)
        elif first_headers == CATEGORY_MAPPING_COLUMNS:
            matches["category_mapping"].append(source_path)
        elif second_headers == REFERENCE_COLUMNS:
            matches["reference"].append(source_path)
        else:
            raise ProductSourceError(
                "A CSV file does not match a supported product source contract"
            )

    for role, paths in matches.items():
        if len(paths) != 1:
            raise ProductSourceError(
                f"Product source directory must contain exactly one {role} CSV"
            )

    return ProductSources(
        catalog=matches["catalog"][0],
        category_mapping=matches["category_mapping"][0],
        reference=matches["reference"][0],
    )


def source_bundle_sha256(sources: ProductSources) -> str:
    digest = hashlib.sha256()
    for role in ("catalog", "category_mapping", "reference"):
        digest.update(role.encode())
        with getattr(sources, role).open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def read_product_records(source_directory: Path) -> list[ProductRecord]:
    return list(_read_product_dataset(discover_product_sources(source_directory)).records)


def import_products(source_directory: Path, engine: Engine | None = None) -> ImportSummary:
    sources = discover_product_sources(source_directory)
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
        dataset = _read_product_dataset(sources)
        rows_read = dataset.rows_read
        _publish_products(database_engine, run_id, list(dataset.records), rows_read)
    except Exception as error:
        rejected = (
            len({issue.row_number for issue in error.issues})
            if isinstance(error, ProductSourceValidationError)
            else 0
        )
        failed_rows_read = (
            error.rows_read if isinstance(error, ProductSourceValidationError) else rows_read
        )
        _mark_import_failed(database_engine, run_id, error, failed_rows_read, rejected)
        raise

    return ImportSummary(rows_read=rows_read, rows_loaded=len(dataset.records), skipped=False)


def _read_product_dataset(sources: ProductSources) -> ProductDataset:
    category_mapping, mapping_rows = _read_category_mapping(sources.category_mapping)
    catalog_records, catalog_rows = _read_catalog(sources.catalog, category_mapping)
    reference_records, reference_rows = _read_reference(sources.reference)

    merged = {record.gtin: record for record in catalog_records}
    for reference in reference_records:
        existing = merged.get(reference.gtin)
        if existing is None:
            merged[reference.gtin] = reference
            continue
        merged[reference.gtin] = replace(
            existing,
            erp_code=reference.erp_code,
            legacy_erp_code=_legacy_value(
                current=reference.erp_code,
                explicit_legacy=reference.legacy_erp_code,
                catalog_value=existing.erp_code,
            ),
            internal_code=reference.internal_code,
            legacy_internal_code=_legacy_value(
                current=reference.internal_code,
                explicit_legacy=reference.legacy_internal_code,
                catalog_value=existing.internal_code,
            ),
            name=reference.name,
        )

    records = list(merged.values())
    _validate_unique_records(records)
    return ProductDataset(
        records=tuple(records),
        rows_read=catalog_rows + mapping_rows + reference_rows,
    )


def _legacy_value(
    *, current: str | None, explicit_legacy: str | None, catalog_value: str | None
) -> str | None:
    candidate = explicit_legacy or catalog_value
    return candidate if candidate and candidate != current else None


def _read_catalog(
    source_path: Path, category_mapping: dict[str, str]
) -> tuple[list[ProductRecord], int]:
    issues: list[ValidationIssue] = []
    records_with_rows: list[tuple[int, ProductRecord]] = []
    rows_read = 0

    try:
        with source_path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source)
            raw_headers = next(reader, None)
            if raw_headers is None:
                raise ProductSourceError("Product catalog is empty")
            headers = tuple(normalize_header(header) for header in raw_headers)
            if headers != CATALOG_COLUMNS:
                raise ProductSourceError(
                    "Product catalog columns do not match the expected contract"
                )

            for row_number, values in enumerate(reader, start=2):
                rows_read += 1
                if len(values) != len(headers):
                    issues.append(
                        ValidationIssue(row_number, "row", "has an unexpected number of columns")
                    )
                    continue
                row = dict(zip(headers, values, strict=True))
                record = _parse_catalog_row(row, row_number, issues, category_mapping)
                if record is not None:
                    records_with_rows.append((row_number, record))
    except UnicodeDecodeError as error:
        raise ProductSourceError("Product catalog must be valid UTF-8") from error

    _append_duplicate_issues(records_with_rows, issues)
    if rows_read == 0:
        raise ProductSourceError("Product catalog contains no data rows")
    if issues:
        raise ProductSourceValidationError(issues, rows_read=rows_read)
    return [record for _, record in records_with_rows], rows_read


def _read_category_mapping(source_path: Path) -> tuple[dict[str, str], int]:
    mapping: dict[str, str] = {}
    issues: list[ValidationIssue] = []
    rows_read = 0
    try:
        with source_path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source)
            raw_headers = next(reader, None)
            if raw_headers is None:
                raise ProductSourceError("Category mapping is empty")
            headers = tuple(normalize_header(header) for header in raw_headers)
            if headers != CATEGORY_MAPPING_COLUMNS:
                raise ProductSourceError(
                    "Category mapping columns do not match the expected contract"
                )
            for row_number, values in enumerate(reader, start=2):
                rows_read += 1
                if len(values) != len(headers):
                    issues.append(
                        ValidationIssue(row_number, "row", "has an unexpected number of columns")
                    )
                    continue
                category, category_code = (clean_text(value) for value in values)
                if not category:
                    issues.append(ValidationIssue(row_number, "categorie", "is required"))
                if not category_code:
                    issues.append(ValidationIssue(row_number, "categorie_court", "is required"))
                if category in mapping:
                    issues.append(ValidationIssue(row_number, "categorie", "is duplicated"))
                if category and category_code:
                    mapping[category] = category_code
    except UnicodeDecodeError as error:
        raise ProductSourceError("Category mapping must be valid UTF-8") from error
    if rows_read == 0:
        raise ProductSourceError("Category mapping contains no data rows")
    if issues:
        raise ProductSourceValidationError(issues, rows_read=rows_read)
    return mapping, rows_read


def _read_reference(source_path: Path) -> tuple[list[ProductRecord], int]:
    records_with_rows: list[tuple[int, ProductRecord]] = []
    issues: list[ValidationIssue] = []
    rows_read = 0
    try:
        with source_path.open("r", encoding="utf-8-sig", newline="") as source:
            rows = list(csv.reader(source))
    except UnicodeDecodeError as error:
        raise ProductSourceError("Product reference must be valid UTF-8") from error
    if len(rows) < 3:
        raise ProductSourceError("Product reference contains no data rows")
    if tuple(normalize_header(value) for value in rows[1]) != REFERENCE_COLUMNS:
        raise ProductSourceError("Product reference columns do not match the expected contract")

    for row_number, values in enumerate(rows[2:], start=3):
        padded = [*values, *([""] * max(0, len(REFERENCE_COLUMNS) - len(values)))]
        if len(padded) != len(REFERENCE_COLUMNS):
            issues.append(ValidationIssue(row_number, "row", "has an unexpected number of columns"))
            continue
        for block_name, indexes in (
            ("left", (0, 1, 2, 3, 4, 5)),
            ("right", (8, None, 9, None, 10, 11)),
        ):
            block_values = [
                clean_text(padded[index]) if index is not None else "" for index in indexes
            ]
            if not any(block_values):
                continue
            rows_read += 1
            internal_code, old_internal_code, erp_code, old_erp_code, gtin, name = block_values
            initial_issue_count = len(issues)
            prefix = f"{block_name}_"
            for value, field in (
                (internal_code, "libelle_court"),
                (gtin, "code_ean"),
                (name, "designation"),
            ):
                if not value:
                    issues.append(ValidationIssue(row_number, prefix + field, "is required"))
            if gtin and not is_valid_gtin(gtin):
                issues.append(
                    ValidationIssue(row_number, prefix + "code_ean", "must be a valid GTIN")
                )
            for value, field in ((erp_code, "code_sap"), (old_erp_code, "ancien_code_sap")):
                if value and not value.isdigit():
                    issues.append(
                        ValidationIssue(row_number, prefix + field, "must contain digits only")
                    )
            if len(issues) == initial_issue_count:
                records_with_rows.append(
                    (
                        row_number,
                        ProductRecord(
                            gtin=gtin,
                            erp_code=erp_code or None,
                            legacy_erp_code=old_erp_code or None,
                            internal_code=internal_code,
                            legacy_internal_code=old_internal_code or None,
                            name=name,
                            brand=None,
                            market=None,
                            category=None,
                            segment=None,
                            content_quantity=None,
                            content_unit=None,
                            average_price=None,
                            average_price_currency=None,
                            category_code=None,
                        ),
                    )
                )
    _append_duplicate_issues(records_with_rows, issues)
    if rows_read == 0:
        raise ProductSourceError("Product reference contains no data rows")
    if issues:
        raise ProductSourceValidationError(issues, rows_read=rows_read)
    return [record for _, record in records_with_rows], rows_read


def _validate_source_file(source_path: Path) -> None:
    if not source_path.is_file():
        raise ProductSourceError("Product source must be an existing file")
    if source_path.suffix.lower() != ".csv":
        raise ProductSourceError("Product source must be a CSV file")
    if source_path.stat().st_size > MAX_SOURCE_BYTES:
        raise ProductSourceError("Product source exceeds the 10 MB limit")


def _read_first_rows(source_path: Path) -> tuple[list[str], list[str]]:
    try:
        with source_path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source)
            return next(reader, []), next(reader, [])
    except UnicodeDecodeError as error:
        raise ProductSourceError("Product source must be valid UTF-8") from error


def _parse_catalog_row(
    row: dict[str, str],
    row_number: int,
    issues: list[ValidationIssue],
    category_mapping: dict[str, str],
) -> ProductRecord | None:
    initial_issue_count = len(issues)
    gtin = _required(row, "ean", row_number, issues)
    internal_code = _required(row, "code_interne", row_number, issues)
    name = _required(row, "nom", row_number, issues)
    brand = _required(row, "marque", row_number, issues)
    market = _required(row, "marche", row_number, issues)
    category = _required(row, "categorie", row_number, issues)
    source_category_code = clean_text(row["categorie_court"])
    category_code = category_mapping.get(category)
    erp_code = clean_text(row["code_sap"]) or None
    segment = clean_text(row["segment"]) or None
    promotion = clean_text(row["promo"])

    if gtin and not is_valid_gtin(gtin):
        issues.append(ValidationIssue(row_number, "ean", "must be a valid GTIN"))
    if erp_code and not erp_code.isdigit():
        issues.append(ValidationIssue(row_number, "code_sap", "must contain digits only"))
    if promotion:
        issues.append(ValidationIssue(row_number, "promo", "is not supported when populated"))
    if category and category_code is None:
        issues.append(ValidationIssue(row_number, "categorie", "is missing from category mapping"))
    if source_category_code and category_code and source_category_code != category_code:
        issues.append(
            ValidationIssue(row_number, "categorie_court", "conflicts with category mapping")
        )

    content_unit = clean_text(row["unite"]) or None
    content_quantity = _optional_content_quantity(row["valeur"], content_unit, row_number, issues)
    average_price, currency = _optional_euro_price(row["prix_moyen"], row_number, issues)

    if len(issues) != initial_issue_count:
        return None
    assert gtin and internal_code and name and brand and market and category and category_code
    return ProductRecord(
        gtin=gtin,
        erp_code=erp_code,
        legacy_erp_code=None,
        internal_code=internal_code,
        legacy_internal_code=None,
        name=name,
        brand=brand,
        market=market,
        category=category,
        segment=segment,
        content_quantity=content_quantity,
        content_unit=content_unit,
        average_price=average_price,
        average_price_currency=currency,
        category_code=category_code,
    )


def _required(
    row: dict[str, str], field: str, row_number: int, issues: list[ValidationIssue]
) -> str:
    value = clean_text(row[field])
    if not value:
        issues.append(ValidationIssue(row_number, field, "is required"))
    return value


def _optional_decimal(
    raw_value: str, field: str, row_number: int, issues: list[ValidationIssue]
) -> Decimal | None:
    value = clean_text(raw_value)
    if not value:
        return None
    try:
        return parse_decimal(value, field=field, row_number=row_number)
    except ProductSourceValidationError as error:
        issues.extend(error.issues)
        return None


def _optional_content_quantity(
    raw_value: str,
    content_unit: str | None,
    row_number: int,
    issues: list[ValidationIssue],
) -> Decimal | None:
    value = clean_text(raw_value)
    if not value:
        return None
    if content_unit and value.lower().endswith(content_unit.lower()):
        value = value[: -len(content_unit)].strip()
    return _optional_decimal(value, "valeur", row_number, issues)


def _optional_euro_price(
    raw_value: str, row_number: int, issues: list[ValidationIssue]
) -> tuple[Decimal | None, str | None]:
    value = clean_text(raw_value)
    if not value:
        return None, None
    if "€" not in value:
        issues.append(
            ValidationIssue(row_number, "prix_moyen", "must include a euro currency symbol")
        )
        return None, None
    return _optional_decimal(value.replace("€", ""), "prix_moyen", row_number, issues), "EUR"


def _append_duplicate_issues(
    records_with_rows: list[tuple[int, ProductRecord]], issues: list[ValidationIssue]
) -> None:
    seen_gtins: set[str] = set()
    seen_erp_codes: set[str] = set()
    for row_number, record in records_with_rows:
        if record.gtin in seen_gtins:
            issues.append(ValidationIssue(row_number, "gtin", "is duplicated in the source"))
        seen_gtins.add(record.gtin)
        if record.erp_code:
            if record.erp_code in seen_erp_codes:
                issues.append(
                    ValidationIssue(row_number, "erp_code", "is duplicated in the source")
                )
            seen_erp_codes.add(record.erp_code)


def _validate_unique_records(records: list[ProductRecord]) -> None:
    erp_codes: set[str] = set()
    issues: list[ValidationIssue] = []
    for position, record in enumerate(records, start=1):
        if record.erp_code and record.erp_code in erp_codes:
            issues.append(
                ValidationIssue(position, "erp_code", "is duplicated after merging sources")
            )
        if record.erp_code:
            erp_codes.add(record.erp_code)
    if issues:
        raise ProductSourceValidationError(issues, rows_read=len(records))


def _publish_products(
    engine: Engine, run_id: uuid.UUID, records: list[ProductRecord], rows_read: int
) -> None:
    values = [asdict(record) | {"is_active": True} for record in records]
    incoming_erp_codes = [record.erp_code for record in records if record.erp_code]
    with Session(engine) as session, session.begin():
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:dataset))"), {"dataset": DATASET}
        )
        session.execute(update(Product).values(is_active=False, updated_at=func.now()))
        if incoming_erp_codes:
            session.execute(
                update(Product)
                .where(Product.erp_code.in_(incoming_erp_codes))
                .values(erp_code=None)
            )
        statement = insert(Product).values(values)
        excluded = statement.excluded
        session.execute(
            statement.on_conflict_do_update(
                index_elements=[Product.gtin],
                set_={
                    "erp_code": excluded.erp_code,
                    "legacy_erp_code": excluded.legacy_erp_code,
                    "internal_code": excluded.internal_code,
                    "legacy_internal_code": excluded.legacy_internal_code,
                    "name": excluded.name,
                    "brand": excluded.brand,
                    "market": excluded.market,
                    "category": excluded.category,
                    "segment": excluded.segment,
                    "content_quantity": excluded.content_quantity,
                    "content_unit": excluded.content_unit,
                    "average_price": excluded.average_price,
                    "average_price_currency": excluded.average_price_currency,
                    "category_code": excluded.category_code,
                    "is_active": True,
                    "updated_at": func.now(),
                },
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
