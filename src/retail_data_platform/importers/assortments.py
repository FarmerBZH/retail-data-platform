from __future__ import annotations

import csv
import hashlib
import re
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, delete, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from retail_data_platform.database.models import (
    Assortment,
    ImportRun,
    ImportStatus,
    Product,
    TypologyMappingRule,
    TypologyRankRule,
)
from retail_data_platform.database.session import create_database_engine

DATASET = "assortments"
SOURCE_BUNDLE_NAME = "monthly assortment source bundle"
IMPORT_CONTRACT_VERSION = "1"
MAX_SOURCE_BYTES = 5_000_000
DATABASE_BATCH_SIZE = 1_000
UUID_NAMESPACE = uuid.UUID("ce3bcb53-df7c-4ed6-a69f-317fc662044f")
SOURCE_COLUMNS = (
    "nom_de_l_enseigne",
    "libelle_categorie",
    "libelle_produit",
    "ean",
    "nom_strate",
)


@dataclass(frozen=True, slots=True)
class ProductIdentity:
    id: uuid.UUID
    gtin: str
    category_code: str | None


@dataclass(frozen=True, slots=True)
class MappingIdentity:
    id: uuid.UUID
    raw_retailer_name: str
    raw_category_name: str
    raw_typology_value: str
    mapped_retailer_name: str | None
    mapped_category_code: str | None
    mapped_typology_value: str | None
    has_source_error: bool


@dataclass(frozen=True, slots=True)
class RankIdentity:
    id: uuid.UUID
    retailer_name: str
    category_code: str
    typology_value: str


@dataclass(frozen=True, slots=True)
class AssortmentRecord:
    id: uuid.UUID
    source_key: str
    period: date
    product_id: uuid.UUID | None
    product_match_status: str
    typology_mapping_rule_id: uuid.UUID | None
    typology_rank_rule_id: uuid.UUID | None
    typology_match_status: str
    typology_match_method: str | None
    source_retailer_name: str
    source_category_name: str
    source_product_name: str
    gtin: str
    source_typology_value: str | None


@dataclass(frozen=True, slots=True)
class AssortmentDataset:
    records: tuple[AssortmentRecord, ...]
    rows_read: int


@dataclass(frozen=True, slots=True)
class ImportSummary:
    rows_read: int
    rows_loaded: int
    skipped: bool


class AssortmentSourceError(ValueError):
    """Raised when assortment sources cannot be safely processed."""


def normalize_header(value: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value)
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


def clean_text(value: str | None) -> str:
    if value is None:
        return ""
    return unicodedata.normalize("NFKC", value).replace("\ufeff", "").replace("\u200b", "").strip()


def discover_assortment_sources(source_directory: Path) -> tuple[tuple[date, Path], ...]:
    if not source_directory.is_dir():
        raise AssortmentSourceError("Assortment source must be an existing directory")
    sources: list[tuple[date, Path]] = []
    periods: set[date] = set()
    for path in sorted(source_directory.glob("*.csv")):
        _validate_source_file(path)
        header, _ = _read_source(path)
        if tuple(normalize_header(value) for value in header) != SOURCE_COLUMNS:
            raise AssortmentSourceError("A monthly assortment file has an unexpected contract")
        period = _month_from_name(path.name)
        if period in periods:
            raise AssortmentSourceError("More than one assortment file exists for a month")
        periods.add(period)
        sources.append((period, path))
    if not sources:
        raise AssortmentSourceError("Assortment source directory contains no monthly CSV files")
    return tuple(sources)


def source_bundle_sha256(sources: tuple[tuple[date, Path], ...]) -> str:
    digest = hashlib.sha256()
    digest.update(f"{DATASET}:{IMPORT_CONTRACT_VERSION}".encode())
    for period, path in sources:
        digest.update(f"monthly:{period.isoformat()}".encode())
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def read_assortment_dataset(
    source_directory: Path,
    products: list[ProductIdentity],
    mapping_rules: list[MappingIdentity],
    rank_rules: list[RankIdentity],
) -> AssortmentDataset:
    sources = discover_assortment_sources(source_directory)
    product_resolver = _ProductResolver(products)
    typology_resolver = _TypologyResolver(mapping_rules, rank_rules)
    records: list[AssortmentRecord] = []
    seen_source_keys: set[str] = set()
    for period, path in sources:
        records.extend(
            _read_month(path, period, product_resolver, typology_resolver, seen_source_keys)
        )
    return AssortmentDataset(records=tuple(records), rows_read=len(records))


def import_assortments(source_directory: Path, engine: Engine | None = None) -> ImportSummary:
    sources = discover_assortment_sources(source_directory)
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
        products = [
            ProductIdentity(*row)
            for row in session.execute(
                select(Product.id, Product.gtin, Product.category_code)
            ).all()
        ]
        mapping_rules = [
            MappingIdentity(*row)
            for row in session.execute(
                select(
                    TypologyMappingRule.id,
                    TypologyMappingRule.raw_retailer_name,
                    TypologyMappingRule.raw_category_name,
                    TypologyMappingRule.raw_typology_value,
                    TypologyMappingRule.mapped_retailer_name,
                    TypologyMappingRule.mapped_category_code,
                    TypologyMappingRule.mapped_typology_value,
                    TypologyMappingRule.has_source_error,
                )
            ).all()
        ]
        rank_rules = [
            RankIdentity(*row)
            for row in session.execute(
                select(
                    TypologyRankRule.id,
                    TypologyRankRule.retailer_name,
                    TypologyRankRule.category_code,
                    TypologyRankRule.typology_value,
                )
            ).all()
        ]
        if not products:
            raise AssortmentSourceError("Products must be imported before assortments")
        if not mapping_rules or not rank_rules:
            raise AssortmentSourceError("Typology rules must be imported before assortments")
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
        dataset = read_assortment_dataset(
            source_directory,
            products,
            mapping_rules,
            rank_rules,
        )
        _publish_assortments(database_engine, run_id, dataset)
    except Exception as error:
        _mark_import_failed(database_engine, run_id, error)
        raise
    return ImportSummary(
        rows_read=dataset.rows_read,
        rows_loaded=len(dataset.records),
        skipped=False,
    )


class _ProductResolver:
    def __init__(self, products: list[ProductIdentity]) -> None:
        self.by_gtin: dict[str, list[ProductIdentity]] = defaultdict(list)
        for product in products:
            self.by_gtin[product.gtin].append(product)

    def resolve(self, gtin: str) -> tuple[uuid.UUID | None, str, str | None]:
        candidates = self.by_gtin.get(gtin, [])
        if not candidates:
            return None, "unresolved", None
        if len(candidates) != 1:
            return None, "conflict", None
        product = candidates[0]
        return product.id, "matched", product.category_code


class _TypologyResolver:
    def __init__(
        self,
        mapping_rules: list[MappingIdentity],
        rank_rules: list[RankIdentity],
    ) -> None:
        self.mapping_rules: dict[tuple[str, str, str], list[MappingIdentity]] = defaultdict(list)
        for mapping_rule in mapping_rules:
            self.mapping_rules[
                (
                    normalize_key(mapping_rule.raw_retailer_name),
                    normalize_key(mapping_rule.raw_category_name),
                    normalize_key(mapping_rule.raw_typology_value),
                )
            ].append(mapping_rule)
        self.rank_rules: dict[tuple[str, str, str], set[uuid.UUID]] = defaultdict(set)
        for rank_rule in rank_rules:
            self.rank_rules[
                (
                    normalize_key(rank_rule.retailer_name),
                    normalize_key(rank_rule.category_code),
                    normalize_key(rank_rule.typology_value),
                )
            ].add(rank_rule.id)

    def resolve(
        self,
        retailer_name: str,
        category_name: str,
        typology_value: str,
        product_category_code: str | None,
    ) -> tuple[uuid.UUID | None, uuid.UUID | None, str, str | None]:
        if not typology_value:
            return None, None, "unsegmented", None
        candidates = self.mapping_rules.get(
            (
                normalize_key(retailer_name),
                normalize_key(category_name),
                normalize_key(typology_value),
            ),
            [],
        )
        if not candidates:
            return None, None, "unmapped", None
        semantic_mappings = {
            (
                normalize_key(candidate.mapped_retailer_name),
                normalize_key(candidate.mapped_category_code),
                normalize_key(candidate.mapped_typology_value),
                candidate.has_source_error,
            )
            for candidate in candidates
        }
        if len(semantic_mappings) != 1:
            return None, None, "mapping_conflict", None
        mapped_retailer, mapped_category, mapped_typology, has_source_error = next(
            iter(semantic_mappings)
        )
        mapping_id = candidates[0].id if len(candidates) == 1 else None
        if has_source_error or not all(
            (
                mapped_retailer,
                mapped_category,
                mapped_typology,
            )
        ):
            return mapping_id, None, "mapping_source_error", None
        ranks = self.rank_rules.get(
            (mapped_retailer, mapped_category, mapped_typology),
            set(),
        )
        match_method = "mapping_rule"
        if not ranks and product_category_code:
            ranks = self.rank_rules.get(
                (
                    mapped_retailer,
                    normalize_key(product_category_code),
                    mapped_typology,
                ),
                set(),
            )
            match_method = "product_category"
        if not ranks:
            return mapping_id, None, "rank_missing", None
        if len(ranks) != 1:
            return mapping_id, None, "rank_conflict", None
        return mapping_id, next(iter(ranks)), "matched", match_method


def _read_month(
    path: Path,
    period: date,
    product_resolver: _ProductResolver,
    typology_resolver: _TypologyResolver,
    seen_source_keys: set[str],
) -> list[AssortmentRecord]:
    raw_headers, rows = _read_source(path)
    headers = [normalize_header(value) for value in raw_headers]
    if tuple(headers) != SOURCE_COLUMNS:
        raise AssortmentSourceError("A monthly assortment file has an unexpected contract")
    records: list[AssortmentRecord] = []
    for row_number, raw_values in enumerate(rows, start=2):
        if len(raw_values) != len(headers):
            raise AssortmentSourceError(
                f"Monthly assortment row {row_number} has an unexpected width"
            )
        row = dict(zip(headers, raw_values, strict=True))
        retailer = clean_text(row["nom_de_l_enseigne"])
        category = clean_text(row["libelle_categorie"])
        product_name = clean_text(row["libelle_produit"])
        gtin = clean_text(row["ean"])
        typology_value = clean_text(row["nom_strate"])
        if not all((retailer, category, product_name, gtin)):
            raise AssortmentSourceError(
                f"Monthly assortment row {row_number} is missing a required field"
            )
        if not gtin.isdigit() or len(gtin) not in {8, 12, 13, 14}:
            raise AssortmentSourceError(
                f"Monthly assortment row {row_number} has an invalid product code"
            )
        source_key = hashlib.sha256(
            f"{period.isoformat()}|{retailer}|{category}|{gtin}|{typology_value}".encode()
        ).hexdigest()
        if source_key in seen_source_keys:
            raise AssortmentSourceError("A monthly assortment source identity is duplicated")
        seen_source_keys.add(source_key)
        product_id, product_status, product_category_code = product_resolver.resolve(gtin)
        mapping_id, rank_id, typology_status, typology_method = typology_resolver.resolve(
            retailer,
            category,
            typology_value,
            product_category_code,
        )
        records.append(
            AssortmentRecord(
                id=uuid.uuid5(UUID_NAMESPACE, f"assortment:{source_key}"),
                source_key=source_key,
                period=period,
                product_id=product_id,
                product_match_status=product_status,
                typology_mapping_rule_id=mapping_id,
                typology_rank_rule_id=rank_id,
                typology_match_status=typology_status,
                typology_match_method=typology_method,
                source_retailer_name=retailer,
                source_category_name=category,
                source_product_name=product_name,
                gtin=gtin,
                source_typology_value=typology_value or None,
            )
        )
    return records


def _read_source(path: Path) -> tuple[list[str], list[list[str]]]:
    raw = path.read_bytes()
    encoding = "utf-16" if raw[:2] in {b"\xff\xfe", b"\xfe\xff"} else "utf-8-sig"
    try:
        text_value = raw.decode(encoding)
    except UnicodeDecodeError:
        try:
            text_value = raw.decode("cp1252")
        except UnicodeDecodeError as error:
            raise AssortmentSourceError(
                "A monthly assortment file has an unsupported encoding"
            ) from error
    rows = [
        row
        for row in csv.reader(text_value.splitlines(), delimiter="|")
        if any(clean_text(value) for value in row)
    ]
    if not rows:
        raise AssortmentSourceError("A monthly assortment file is empty")
    return rows[0], rows[1:]


def _month_from_name(name: str) -> date:
    match = re.match(r"^(\d{4})(\d{2})", name)
    if match is None:
        raise AssortmentSourceError("Monthly assortment filename must start with YYYYMM")
    try:
        return date(int(match.group(1)), int(match.group(2)), 1)
    except ValueError as error:
        raise AssortmentSourceError(
            "Monthly assortment filename contains an invalid month"
        ) from error


def _validate_source_file(path: Path) -> None:
    if not path.is_file() or path.suffix.lower() != ".csv":
        raise AssortmentSourceError("Assortment sources must be existing CSV files")
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise AssortmentSourceError("An assortment source exceeds the 5 MB limit")


def _publish_assortments(
    engine: Engine,
    run_id: uuid.UUID,
    dataset: AssortmentDataset,
) -> None:
    with Session(engine) as session, session.begin():
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:dataset))"),
            {"dataset": DATASET},
        )
        session.execute(select(ImportRun.id).where(ImportRun.id == run_id).with_for_update())
        session.execute(delete(Assortment))
        _insert_batches(session, Assortment, dataset.records)
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
