from __future__ import annotations

import csv
import hashlib
import re
import unicodedata
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from sqlalchemy import Engine, func, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from retail_data_platform.database.models import ImportRun, ImportStatus, Product
from retail_data_platform.database.session import create_database_engine

DATASET = "products"
MAX_SOURCE_BYTES = 10_000_000
EXPECTED_SOURCE_COLUMNS = (
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


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    row_number: int
    field: str
    message: str


@dataclass(frozen=True, slots=True)
class ProductRecord:
    gtin: str
    erp_code: str | None
    internal_code: str
    name: str
    brand: str
    market: str
    category: str
    segment: str | None
    content_quantity: Decimal | None
    content_unit: str | None
    average_price: Decimal | None
    average_price_currency: str | None
    category_code: str


@dataclass(frozen=True, slots=True)
class ImportSummary:
    rows_read: int
    rows_loaded: int
    skipped: bool


class ProductSourceError(ValueError):
    """Raised when the product source cannot be safely processed."""


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


def source_sha256(source_path: Path) -> str:
    digest = hashlib.sha256()
    with source_path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def read_product_records(source_path: Path) -> list[ProductRecord]:
    _validate_source_file(source_path)
    issues: list[ValidationIssue] = []
    records_with_rows: list[tuple[int, ProductRecord]] = []
    rows_read = 0

    try:
        with source_path.open("r", encoding="utf-8-sig", newline="") as source:
            reader = csv.reader(source)
            raw_headers = next(reader, None)
            if raw_headers is None:
                raise ProductSourceError("Product source is empty")
            headers = tuple(normalize_header(header) for header in raw_headers)
            if headers != EXPECTED_SOURCE_COLUMNS:
                raise ProductSourceError(
                    "Product source columns do not match the expected contract"
                )

            for row_number, values in enumerate(reader, start=2):
                rows_read += 1
                if len(values) != len(headers):
                    issues.append(
                        ValidationIssue(row_number, "row", "has an unexpected number of columns")
                    )
                    continue
                row = dict(zip(headers, values, strict=True))
                record = _parse_product_row(row, row_number, issues)
                if record is not None:
                    records_with_rows.append((row_number, record))
    except UnicodeDecodeError as error:
        raise ProductSourceError("Product source must be valid UTF-8") from error

    _append_duplicate_issues(records_with_rows, issues)
    if rows_read == 0:
        raise ProductSourceError("Product source contains no data rows")
    if issues:
        raise ProductSourceValidationError(issues, rows_read=rows_read)
    return [record for _, record in records_with_rows]


def import_products(source_path: Path, engine: Engine | None = None) -> ImportSummary:
    _validate_source_file(source_path)
    database_engine = engine or create_database_engine()
    checksum = source_sha256(source_path)

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
            source_file_name=source_path.name,
            source_sha256=checksum,
            status=ImportStatus.RUNNING.value,
        )
        session.add(run)
        session.flush()
        run_id = run.id
        session.commit()

    rows_read = 0
    try:
        records = read_product_records(source_path)
        rows_read = len(records)
        _publish_products(database_engine, run_id, records)
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

    return ImportSummary(rows_read=rows_read, rows_loaded=rows_read, skipped=False)


def _validate_source_file(source_path: Path) -> None:
    if not source_path.is_file():
        raise ProductSourceError("Product source must be an existing file")
    if source_path.suffix.lower() != ".csv":
        raise ProductSourceError("Product source must be a CSV file")
    if source_path.stat().st_size > MAX_SOURCE_BYTES:
        raise ProductSourceError("Product source exceeds the 10 MB limit")
    if len(source_path.name) > 255:
        raise ProductSourceError("Product source file name exceeds 255 characters")


def _parse_product_row(
    row: dict[str, str],
    row_number: int,
    issues: list[ValidationIssue],
) -> ProductRecord | None:
    initial_issue_count = len(issues)
    gtin = _required(row, "ean", row_number, issues)
    internal_code = _required(row, "code_interne", row_number, issues)
    name = _required(row, "nom", row_number, issues)
    brand = _required(row, "marque", row_number, issues)
    market = _required(row, "marche", row_number, issues)
    category = _required(row, "categorie", row_number, issues)
    category_code = _required(row, "categorie_court", row_number, issues)
    erp_code = clean_text(row["code_sap"]) or None
    segment = clean_text(row["segment"]) or None
    promotion = clean_text(row["promo"])

    if gtin and not is_valid_gtin(gtin):
        issues.append(ValidationIssue(row_number, "ean", "must be a valid GTIN"))
    if erp_code and not erp_code.isdigit():
        issues.append(ValidationIssue(row_number, "code_sap", "must contain digits only"))
    if promotion:
        issues.append(ValidationIssue(row_number, "promo", "is not supported when populated"))

    content_unit = clean_text(row["unite"]) or None
    content_quantity = _optional_content_quantity(row["valeur"], content_unit, row_number, issues)

    average_price, currency = _optional_euro_price(row["prix_moyen"], row_number, issues)

    if len(issues) != initial_issue_count:
        return None
    assert gtin and internal_code and name and brand and market and category and category_code
    return ProductRecord(
        gtin=gtin,
        erp_code=erp_code,
        internal_code=internal_code,
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
    row: dict[str, str],
    field: str,
    row_number: int,
    issues: list[ValidationIssue],
) -> str:
    value = clean_text(row[field])
    if not value:
        issues.append(ValidationIssue(row_number, field, "is required"))
    return value


def _optional_decimal(
    raw_value: str,
    field: str,
    row_number: int,
    issues: list[ValidationIssue],
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
    raw_value: str,
    row_number: int,
    issues: list[ValidationIssue],
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
    records_with_rows: list[tuple[int, ProductRecord]],
    issues: list[ValidationIssue],
) -> None:
    seen_gtins: set[str] = set()
    seen_erp_codes: set[str] = set()
    for row_number, record in records_with_rows:
        if record.gtin in seen_gtins:
            issues.append(ValidationIssue(row_number, "ean", "is duplicated in the source"))
        seen_gtins.add(record.gtin)
        if record.erp_code:
            if record.erp_code in seen_erp_codes:
                issues.append(
                    ValidationIssue(row_number, "code_sap", "is duplicated in the source")
                )
            seen_erp_codes.add(record.erp_code)


def _publish_products(engine: Engine, run_id: uuid.UUID, records: list[ProductRecord]) -> None:
    values = [asdict(record) | {"is_active": True} for record in records]
    with Session(engine) as session, session.begin():
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:dataset))"), {"dataset": DATASET}
        )
        session.execute(update(Product).values(is_active=False, updated_at=func.now()))
        statement = insert(Product).values(values)
        excluded = statement.excluded
        session.execute(
            statement.on_conflict_do_update(
                index_elements=[Product.gtin],
                set_={
                    "erp_code": excluded.erp_code,
                    "internal_code": excluded.internal_code,
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
                rows_read=len(records),
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
