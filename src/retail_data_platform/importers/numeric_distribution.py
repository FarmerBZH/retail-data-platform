from __future__ import annotations

import csv
import hashlib
import re
import unicodedata
import uuid
from collections import defaultdict
from collections.abc import Iterator
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
    NumericDistributionObservation,
    Product,
    Store,
)
from retail_data_platform.database.session import create_database_engine

DATASET = "numeric_distribution"
SOURCE_BUNDLE_NAME = "monthly numeric distribution source bundle"
IMPORT_CONTRACT_VERSION = "1"
MAX_SOURCE_BYTES = 100_000_000
DATABASE_BATCH_SIZE = 5_000
UUID_NAMESPACE = uuid.UUID("bf099785-43fb-4fa0-9692-ddaa150c7a40")
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
class ProductIdentity:
    id: uuid.UUID
    gtin: str
    erp_code: str | None
    legacy_erp_code: str | None
    internal_code: str
    legacy_internal_code: str | None
    name: str
    category_code: str | None


@dataclass(frozen=True, slots=True)
class DistributionSource:
    source_category: str
    period: date
    path: Path


@dataclass(frozen=True, slots=True)
class DistributionSources:
    monthly: tuple[DistributionSource, ...]
    aliases: Path


@dataclass(frozen=True, slots=True)
class EntityMatch:
    reference: str
    label: str
    entity_id: uuid.UUID | None
    status: str
    method: str | None
    category_code: str | None = None


@dataclass(slots=True)
class DistributionPartition:
    source_category: str
    category_code: str
    period: date
    stores: dict[str, EntityMatch]
    products: dict[str, EntityMatch]
    reported_values: dict[tuple[str, str], int]


@dataclass(frozen=True, slots=True)
class DistributionRecord:
    id: uuid.UUID
    source_key: str
    period: date
    category_code: str
    store_id: uuid.UUID | None
    store_match_status: str
    store_match_method: str | None
    product_id: uuid.UUID | None
    product_match_status: str
    product_match_method: str | None
    presence_value: int
    value_origin: str
    source_category_name: str
    source_store_reference: str
    source_store_label: str
    source_product_reference: str
    source_product_label: str


@dataclass(frozen=True, slots=True)
class DistributionDataset:
    partitions: tuple[DistributionPartition, ...]
    rows_read: int
    duplicate_rows: int
    rows_loaded: int


@dataclass(frozen=True, slots=True)
class ImportSummary:
    rows_read: int
    rows_loaded: int
    rows_rejected: int
    skipped: bool


@dataclass(frozen=True, slots=True)
class AliasMaps:
    stores: dict[str, set[str]]
    products: dict[str, set[str]]
    stores_by_source: dict[str, dict[str, set[str]]]
    products_by_source: dict[str, dict[str, set[str]]]


class NumericDistributionSourceError(ValueError):
    """Raised when numeric distribution sources cannot be safely processed."""


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


def discover_distribution_sources(
    source_directory: Path, aliases_file: Path
) -> DistributionSources:
    if not source_directory.is_dir():
        raise NumericDistributionSourceError(
            "Numeric distribution source must be an existing directory"
        )
    category_directories = sorted(path for path in source_directory.iterdir() if path.is_dir())
    if len(category_directories) != 3:
        raise NumericDistributionSourceError(
            "Numeric distribution source must contain exactly three category directories"
        )
    monthly: list[DistributionSource] = []
    period_sets: list[set[date]] = []
    normalized_categories: set[str] = set()
    for directory in category_directories:
        source_category = clean_text(directory.name)
        category_key = normalize_key(source_category)
        if not source_category or not category_key or category_key in normalized_categories:
            raise NumericDistributionSourceError(
                "Numeric distribution category directories have an invalid identity"
            )
        if len(source_category) > 128:
            raise NumericDistributionSourceError(
                "A numeric distribution source category exceeds the length limit"
            )
        normalized_categories.add(category_key)
        periods: set[date] = set()
        for path in sorted(directory.iterdir()):
            if path.suffix.lower() not in {".xls", ".csv"}:
                continue
            _validate_monthly_file(path)
            period = _month_from_name(path.name)
            if period in periods:
                raise NumericDistributionSourceError(
                    "More than one numeric distribution file exists for a category and month"
                )
            periods.add(period)
            monthly.append(DistributionSource(source_category, period, path))
        if not periods:
            raise NumericDistributionSourceError(
                "A numeric distribution category contains no monthly files"
            )
        period_sets.append(periods)
    if len({frozenset(periods) for periods in period_sets}) != 1:
        raise NumericDistributionSourceError(
            "Numeric distribution categories do not cover the same months"
        )
    _validate_alias_file(aliases_file)
    return DistributionSources(
        monthly=tuple(sorted(monthly, key=lambda source: (source.period, source.source_category))),
        aliases=aliases_file,
    )


def source_bundle_sha256(sources: DistributionSources) -> str:
    digest = hashlib.sha256()
    digest.update(f"{DATASET}:{IMPORT_CONTRACT_VERSION}".encode())
    for source in sources.monthly:
        digest.update(
            f"{normalize_key(source.source_category)}:{source.period.isoformat()}".encode()
        )
        _update_digest(digest, source.path)
    digest.update(b"aliases")
    _update_digest(digest, sources.aliases)
    return digest.hexdigest()


def read_distribution_dataset(
    source_directory: Path,
    aliases_file: Path,
    stores: list[StoreIdentity],
    products: list[ProductIdentity],
) -> DistributionDataset:
    sources = discover_distribution_sources(source_directory, aliases_file)
    aliases = _read_aliases(sources.aliases)
    store_resolver = _StoreResolver(stores, aliases.stores, aliases.stores_by_source)
    product_resolver = _ProductResolver(
        products,
        aliases.products,
        aliases.products_by_source,
    )
    partitions: dict[tuple[str, date], DistributionPartition] = {}
    rows_read = 0
    duplicate_rows = 0
    for source in sources.monthly:
        partition = DistributionPartition(
            source_category=source.source_category,
            category_code="",
            period=source.period,
            stores={},
            products={},
            reported_values={},
        )
        for row_number, (
            store_label,
            store_reference,
            product_label,
            product_reference,
            value,
        ) in enumerate(_read_monthly_rows(source.path), start=1):
            rows_read += 1
            _validate_reference(store_reference, store_label, "store", row_number)
            _validate_reference(product_reference, product_label, "product", row_number)
            store_key = normalize_key(store_reference)
            product_key = normalize_key(product_reference)
            if not store_key or not product_key:
                raise NumericDistributionSourceError(
                    f"Numeric distribution row {row_number} has an invalid identity"
                )
            if store_key not in partition.stores:
                partition.stores[store_key] = store_resolver.resolve(
                    store_reference,
                    store_label,
                    source.source_category,
                )
            if product_key not in partition.products:
                partition.products[product_key] = product_resolver.resolve(
                    product_reference,
                    product_label,
                    source.source_category,
                )
            identity = (store_key, product_key)
            previous = partition.reported_values.get(identity)
            if previous is not None:
                if previous != value:
                    raise NumericDistributionSourceError(
                        "A numeric distribution source identity has conflicting values"
                    )
                duplicate_rows += 1
                continue
            partition.reported_values[identity] = value
        partitions[(normalize_key(source.source_category), source.period)] = partition

    matched_category_codes: dict[str, set[str]] = defaultdict(set)
    for partition in partitions.values():
        source_category_key = normalize_key(partition.source_category)
        matched_category_codes[source_category_key].update(
            product.category_code
            for product in partition.products.values()
            if product.status == "matched" and product.category_code
        )
    category_codes: dict[str, str] = {}
    source_category_keys = {
        normalize_key(partition.source_category) for partition in partitions.values()
    }
    for source_category_key in source_category_keys:
        matched_codes = matched_category_codes.get(source_category_key, set())
        normalized_codes = {normalize_key(code) for code in matched_codes}
        if len(normalized_codes) != 1:
            raise NumericDistributionSourceError(
                "A numeric distribution source category cannot be mapped to one product category"
            )
        category_codes[source_category_key] = sorted(matched_codes)[0]
    for partition in partitions.values():
        partition.category_code = category_codes[normalize_key(partition.source_category)]

    ordered_partitions = tuple(
        sorted(partitions.values(), key=lambda item: (item.period, item.source_category))
    )
    rows_loaded = sum(
        len(partition.stores) * len(partition.products) for partition in ordered_partitions
    )
    return DistributionDataset(
        partitions=ordered_partitions,
        rows_read=rows_read,
        duplicate_rows=duplicate_rows,
        rows_loaded=rows_loaded,
    )


def iter_distribution_records(dataset: DistributionDataset) -> Iterator[DistributionRecord]:
    for partition in dataset.partitions:
        for store_key in sorted(partition.stores):
            store = partition.stores[store_key]
            for product_key in sorted(partition.products):
                product = partition.products[product_key]
                reported_value = partition.reported_values.get((store_key, product_key))
                presence_value = reported_value if reported_value is not None else 0
                value_origin = "reported" if reported_value is not None else "inferred_absence"
                source_key = hashlib.sha256(
                    (
                        f"{normalize_key(partition.source_category)}|{partition.period.isoformat()}|"
                        f"{store_key}|{product_key}"
                    ).encode()
                ).hexdigest()
                yield DistributionRecord(
                    id=uuid.uuid5(UUID_NAMESPACE, f"numeric-distribution:{source_key}"),
                    source_key=source_key,
                    period=partition.period,
                    category_code=partition.category_code,
                    store_id=store.entity_id,
                    store_match_status=store.status,
                    store_match_method=store.method,
                    product_id=product.entity_id,
                    product_match_status=product.status,
                    product_match_method=product.method,
                    presence_value=presence_value,
                    value_origin=value_origin,
                    source_category_name=partition.source_category,
                    source_store_reference=store.reference,
                    source_store_label=store.label,
                    source_product_reference=product.reference,
                    source_product_label=product.label,
                )


def import_numeric_distribution(
    source_directory: Path,
    aliases_file: Path,
    engine: Engine | None = None,
) -> ImportSummary:
    sources = discover_distribution_sources(source_directory, aliases_file)
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
        products = [
            ProductIdentity(*row)
            for row in session.execute(
                select(
                    Product.id,
                    Product.gtin,
                    Product.erp_code,
                    Product.legacy_erp_code,
                    Product.internal_code,
                    Product.legacy_internal_code,
                    Product.name,
                    Product.category_code,
                )
            ).all()
        ]
        if not stores or not products:
            raise NumericDistributionSourceError(
                "Stores and products must be imported before numeric distribution"
            )
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
        dataset = read_distribution_dataset(
            source_directory,
            aliases_file,
            stores,
            products,
        )
        _publish_distribution(database_engine, run_id, dataset)
    except Exception as error:
        _mark_import_failed(database_engine, run_id, error)
        raise
    return ImportSummary(
        dataset.rows_read,
        dataset.rows_loaded,
        dataset.duplicate_rows,
        False,
    )


class _ExactResolver:
    def _resolve_groups(
        self, candidate_groups: list[set[uuid.UUID]], methods: list[str]
    ) -> tuple[uuid.UUID | None, str, str | None]:
        if not candidate_groups:
            return None, "unresolved", None
        intersection = set.intersection(*candidate_groups)
        union = set.union(*candidate_groups)
        resolved = intersection if len(intersection) == 1 else union if len(union) == 1 else set()
        method = "+".join(sorted(set(methods)))
        if len(resolved) == 1:
            return next(iter(resolved)), "matched", method
        return None, "conflict", method or "multiple_candidates"


class _StoreResolver(_ExactResolver):
    def __init__(
        self,
        stores: list[StoreIdentity],
        aliases: dict[str, set[str]],
        aliases_by_source: dict[str, dict[str, set[str]]] | None = None,
    ) -> None:
        self.aliases = aliases
        self.aliases_by_source = aliases_by_source or {}
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
                if normalized := normalize_key(value):
                    self.codes[normalized].add(store.id)
            if erp_key := normalize_key(store.erp_code):
                self.erp_codes[erp_key].add(store.id)
            for value in (store.name, store.legal_name):
                if normalized := normalize_key(value):
                    self.names[normalized].add(store.id)

    def resolve(self, reference: str, label: str, source_category: str = "") -> EntityMatch:
        groups: list[set[uuid.UUID]] = []
        methods: list[str] = []
        reference_key = normalize_key(reference)
        label_key = normalize_key(label)
        if candidates := self.codes.get(reference_key):
            groups.append(candidates)
            methods.append("code")
        for candidate_key in {reference_key, label_key}:
            if candidates := self.names.get(candidate_key):
                groups.append(candidates)
                methods.append("name")
            targets = _alias_targets(
                candidate_key,
                source_category,
                self.aliases,
                self.aliases_by_source,
            )
            alias_candidates = set().union(
                *(self.erp_codes.get(target, set()) for target in targets)
            )
            if alias_candidates:
                groups.append(alias_candidates)
                methods.append("alias")
        entity_id, status, method = self._resolve_groups(groups, methods)
        return EntityMatch(reference, label, entity_id, status, method)


class _ProductResolver(_ExactResolver):
    def __init__(
        self,
        products: list[ProductIdentity],
        aliases: dict[str, set[str]],
        aliases_by_source: dict[str, dict[str, set[str]]] | None = None,
    ) -> None:
        self.aliases = aliases
        self.aliases_by_source = aliases_by_source or {}
        self.direct: dict[str, set[uuid.UUID]] = defaultdict(set)
        self.gtin: dict[str, set[uuid.UUID]] = defaultdict(set)
        self.identities = {product.id: product for product in products}
        for product in products:
            for value in (
                product.gtin,
                product.erp_code,
                product.legacy_erp_code,
                product.internal_code,
                product.legacy_internal_code,
                product.name,
            ):
                if normalized := normalize_key(value):
                    self.direct[normalized].add(product.id)
            self.gtin[normalize_key(product.gtin)].add(product.id)

    def resolve(self, reference: str, label: str, source_category: str = "") -> EntityMatch:
        groups: list[set[uuid.UUID]] = []
        methods: list[str] = []
        reference_key = normalize_key(reference)
        label_key = normalize_key(label)
        for candidate_key in {reference_key, label_key}:
            if candidates := self.direct.get(candidate_key):
                groups.append(candidates)
                methods.append("direct")
            targets = _alias_targets(
                candidate_key,
                source_category,
                self.aliases,
                self.aliases_by_source,
            )
            alias_candidates = set().union(*(self.gtin.get(target, set()) for target in targets))
            if alias_candidates:
                groups.append(alias_candidates)
                methods.append("alias")
        entity_id, status, method = self._resolve_groups(groups, methods)
        category_code = self.identities[entity_id].category_code if entity_id else None
        return EntityMatch(reference, label, entity_id, status, method, category_code)


class _DistributionTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[tuple[list[str], list[str]]] = []
        self._headers: list[str] = []
        self._values: list[str] = []
        self._cell_kind: str | None = None
        self._cell_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        del attrs
        tag = tag.lower()
        if tag == "tr":
            self._headers, self._values = [], []
        elif tag in {"th", "td"}:
            self._cell_kind, self._cell_text = tag, []

    def handle_data(self, data: str) -> None:
        if self._cell_kind:
            self._cell_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"th", "td"} and self._cell_kind == tag:
            target = self._headers if tag == "th" else self._values
            target.append(clean_text("".join(self._cell_text)))
            self._cell_kind, self._cell_text = None, []
        elif tag == "tr" and (self._headers or self._values):
            self.rows.append((self._headers.copy(), self._values.copy()))


def _read_monthly_rows(path: Path) -> list[tuple[str, str, str, str, int]]:
    raw = path.read_bytes()
    if path.suffix.lower() == ".csv":
        return _read_csv_rows(raw)
    return _read_html_rows(raw)


def _read_html_rows(raw: bytes) -> list[tuple[str, str, str, str, int]]:
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            content = raw.decode("cp1252")
        except UnicodeDecodeError as error:
            raise NumericDistributionSourceError(
                "A numeric distribution HTML file has an unsupported encoding"
            ) from error
    parser = _DistributionTableParser()
    parser.feed(content)
    rows: list[tuple[str, str, str, str, int]] = []
    for row_number, (headers, values) in enumerate(parser.rows, start=1):
        if not headers or not values:
            continue
        if len(headers) != 2 or len(values) != 1:
            raise NumericDistributionSourceError(
                f"Numeric distribution HTML row {row_number} has an unexpected shape"
            )
        store_label, product_label = headers
        rows.append(
            (
                store_label,
                _last_bracket_reference(store_label, row_number, "store"),
                product_label,
                _product_reference(product_label, row_number),
                _parse_presence(values[0], row_number),
            )
        )
    if not rows:
        raise NumericDistributionSourceError(
            "A numeric distribution HTML file contains no data rows"
        )
    return rows


def _read_csv_rows(raw: bytes) -> list[tuple[str, str, str, str, int]]:
    encoding = "utf-16" if raw[:2] in {b"\xff\xfe", b"\xfe\xff"} else "utf-8-sig"
    try:
        content = raw.decode(encoding)
    except UnicodeDecodeError:
        try:
            content = raw.decode("cp1252")
        except UnicodeDecodeError as error:
            raise NumericDistributionSourceError(
                "A numeric distribution CSV file has an unsupported encoding"
            ) from error
    rows = [row for row in csv.reader(content.splitlines()) if any(clean_text(v) for v in row)]
    if not rows:
        raise NumericDistributionSourceError("A numeric distribution CSV file is empty")
    headers = [normalize_header(value) for value in rows[0]]
    while headers and not headers[-1]:
        headers.pop()
    if tuple(headers) != ("client", "produit", "dn"):
        raise NumericDistributionSourceError(
            "A numeric distribution CSV file has an unexpected contract"
        )
    result: list[tuple[str, str, str, str, int]] = []
    for row_number, raw_values in enumerate(rows[1:], start=2):
        values = [clean_text(value) for value in raw_values]
        while len(values) > len(headers) and not values[-1]:
            values.pop()
        if len(values) != len(headers):
            raise NumericDistributionSourceError(
                f"Numeric distribution CSV row {row_number} has an unexpected width"
            )
        store, product, presence = values
        result.append((store, store, product, product, _parse_presence(presence, row_number)))
    if not result:
        raise NumericDistributionSourceError(
            "A numeric distribution CSV file contains no data rows"
        )
    return result


def _read_aliases(path: Path) -> AliasMaps:
    raw = path.read_bytes()
    encoding = "utf-16" if raw[:2] in {b"\xff\xfe", b"\xfe\xff"} else "utf-8-sig"
    try:
        content = raw.decode(encoding)
    except UnicodeDecodeError as error:
        raise NumericDistributionSourceError("Alias source has an unsupported encoding") from error
    rows = [row for row in csv.reader(content.splitlines()) if any(clean_text(v) for v in row)]
    if not rows:
        raise NumericDistributionSourceError("Alias source is empty")
    headers = [normalize_header(value) for value in rows[0]]
    if tuple(headers) != ALIAS_COLUMNS:
        raise NumericDistributionSourceError("Alias source has an unexpected contract")
    stores: dict[str, set[str]] = defaultdict(set)
    products: dict[str, set[str]] = defaultdict(set)
    stores_by_source: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    products_by_source: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    for row_number, values in enumerate(rows[1:], start=2):
        if len(values) != len(headers):
            raise NumericDistributionSourceError(f"Alias row {row_number} has an unexpected width")
        row = dict(zip(headers, values, strict=True))
        category = normalize_key(row["category"])
        target = normalize_key(row[ALIAS_COLUMNS[-1]])
        if not target:
            continue
        destination = (
            stores if category == "CLIENT" else products if category in {"PRODUCT", "EAN"} else None
        )
        source_destination = (
            stores_by_source
            if category == "CLIENT"
            else products_by_source
            if category in {"PRODUCT", "EAN"}
            else None
        )
        if destination is None:
            continue
        systems = {
            normalize_key(system)
            for system in clean_text(row["sources"]).split(",")
            if normalize_key(system)
        }
        for field in ("raw_values", "normalized_id"):
            if alias := normalize_key(row[field]):
                destination[alias].add(target)
                if source_destination is not None:
                    for system in systems:
                        source_destination[alias][system].add(target)
    return AliasMaps(
        dict(stores),
        dict(products),
        {alias: dict(systems) for alias, systems in stores_by_source.items()},
        {alias: dict(systems) for alias, systems in products_by_source.items()},
    )


def _alias_targets(
    alias: str,
    source_category: str,
    generic: dict[str, set[str]],
    by_source: dict[str, dict[str, set[str]]],
) -> set[str]:
    source_key = normalize_key(source_category)
    source_targets: set[str] = set()
    for system, targets in by_source.get(alias, {}).items():
        if system == source_key or system in source_key or source_key in system:
            source_targets.update(targets)
    return source_targets or generic.get(alias, set())


def _last_bracket_reference(label: str, row_number: int, role: str) -> str:
    groups = re.findall(r"\[([^\[\]]+)\]", label)
    if not groups or not groups[-1].split():
        raise NumericDistributionSourceError(
            f"Numeric distribution HTML row {row_number} has no {role} reference"
        )
    return clean_text(groups[-1].split()[-1])


def _product_reference(label: str, row_number: int) -> str:
    groups = re.findall(r"\[([^\[\]]+)\]", label)
    product_indexes = [
        index for index, value in enumerate(groups) if clean_text(value).upper() == "PRODUIT"
    ]
    if product_indexes and product_indexes[0] + 1 < len(groups):
        return clean_text(groups[product_indexes[0] + 1])
    if len(groups) >= 3:
        return clean_text(groups[2])
    if groups:
        return clean_text(groups[-1])
    raise NumericDistributionSourceError(
        f"Numeric distribution HTML row {row_number} has no product reference"
    )


def _parse_presence(value: str, row_number: int) -> int:
    normalized = clean_text(value).replace("\u00a0", "").replace(" ", "")
    if normalized not in {"0", "1"}:
        raise NumericDistributionSourceError(
            f"Numeric distribution row {row_number} has a non-binary value"
        )
    return int(normalized)


def _validate_reference(reference: str, label: str, role: str, row_number: int) -> None:
    if not reference or len(reference) > 128 or not label or len(label) > 512:
        raise NumericDistributionSourceError(
            f"Numeric distribution row {row_number} has an invalid {role} reference"
        )


def _month_from_name(name: str) -> date:
    match = re.match(r"^(\d{4})(\d{2})", name)
    if match is None:
        raise NumericDistributionSourceError(
            "Monthly numeric distribution filename must start with YYYYMM"
        )
    try:
        return date(int(match.group(1)), int(match.group(2)), 1)
    except ValueError as error:
        raise NumericDistributionSourceError(
            "Monthly numeric distribution filename has an invalid month"
        ) from error


def _validate_monthly_file(path: Path) -> None:
    if not path.is_file() or path.suffix.lower() not in {".xls", ".csv"}:
        raise NumericDistributionSourceError(
            "Numeric distribution sources must be existing XLS or CSV files"
        )
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise NumericDistributionSourceError(
            "A numeric distribution source exceeds the 100 MB limit"
        )
    prefix = path.read_bytes()[:512].lstrip().lower()
    if path.suffix.lower() == ".xls" and not (prefix.startswith(b"<") and b"html" in prefix):
        raise NumericDistributionSourceError(
            "An XLS numeric distribution source is not an HTML table"
        )


def _validate_alias_file(path: Path) -> None:
    if not path.is_file() or path.suffix.lower() != ".csv":
        raise NumericDistributionSourceError(
            "Numeric distribution aliases must be an existing CSV file"
        )
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise NumericDistributionSourceError("Alias source exceeds the 100 MB limit")


def _update_digest(digest: Any, path: Path) -> None:
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)


def _publish_distribution(
    engine: Engine,
    run_id: uuid.UUID,
    dataset: DistributionDataset,
) -> None:
    with Session(engine) as session, session.begin():
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:dataset))"),
            {"dataset": DATASET},
        )
        session.execute(select(ImportRun.id).where(ImportRun.id == run_id).with_for_update())
        session.execute(delete(NumericDistributionObservation))
        batch: list[dict[str, Any]] = []
        for record in iter_distribution_records(dataset):
            batch.append(asdict(record))
            if len(batch) == DATABASE_BATCH_SIZE:
                session.execute(insert(NumericDistributionObservation), batch)
                batch.clear()
        if batch:
            session.execute(insert(NumericDistributionObservation), batch)
        session.execute(
            update(ImportRun)
            .where(ImportRun.id == run_id)
            .values(
                status=ImportStatus.SUCCEEDED.value,
                rows_read=dataset.rows_read,
                rows_inserted=dataset.rows_loaded,
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
