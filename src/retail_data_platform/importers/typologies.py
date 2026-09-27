from __future__ import annotations

import csv
import hashlib
import re
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass, replace
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, delete, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from retail_data_platform.database.models import (
    Assortment,
    ImportRun,
    ImportStatus,
    Store,
    StoreTypologyValue,
    TypologyMappingRule,
    TypologyRankRule,
    TypologySnapshot,
)
from retail_data_platform.database.session import create_database_engine

DATASET = "typologies"
SOURCE_BUNDLE_NAME = "typology source bundle"
IMPORT_CONTRACT_VERSION = "2"
MAX_SOURCE_BYTES = 5_000_000
DATABASE_BATCH_SIZE = 1_000
UUID_NAMESPACE = uuid.UUID("7413ef73-3c68-4cb1-a89e-10b64a75ce57")
BASE_COLUMNS = (
    "tdlinx",
    "id_du_point_de_vente",
    "source_customer_code",
    "dr",
    "cds",
    "nom_de_l_enseigne",
    "info_comp",
    "cp",
)
MONTHLY_COLUMNS = (
    *BASE_COLUMNS,
    "boissons_a_infuser",
    "boissons_a_infuser_bio",
    "capillaire_femme",
    "coloration",
    "complements_alimentaires",
    "couches_bebe",
    "cremes_mains_pieds",
    "dentaire",
    "deodorants_femme",
    "douche_femme",
    "hygiene_et_lingettes_bebe",
    "hygiene_intime",
    "parapharmacie",
    "savons_gels_lavants_mains_bio",
    "soins_du_corps_femme",
    "soins_du_visage",
    "univers_homme",
)
ALIAS_COLUMNS = (
    "category",
    "normalized_id",
    "raw_values",
    "sources",
    "correspondance_avec_le_fichier_magasin_codesap_ou_produits_ean",
)
RANK_COLUMNS = (
    "nom_de_l_enseigne",
    "categorie",
    "categorie_court",
    *(f"typologies_r{rank}" for rank in range(1, 13)),
)
MAPPING_COLUMNS = (
    "enseigne",
    "categorie",
    "categorie_court",
    "typologie",
    "correspondance_parmi_les_enseignes",
    "correspondance_parmi_les_categories_courtes",
    "correspondance_parmi_les_typologies",
    "error",
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
    name: str | None = None
    legal_name: str | None = None
    postal_code: str | None = None


@dataclass(frozen=True, slots=True)
class TypologySources:
    monthly: tuple[tuple[date, Path], ...]
    aliases: Path
    rank_rules: Path
    mapping_rules: Path


@dataclass(frozen=True, slots=True)
class SnapshotRecord:
    id: uuid.UUID
    source_key: str
    period: date
    store_id: uuid.UUID | None
    store_match_status: str
    store_match_method: str | None
    retail_panel_code: str | None
    source_customer_code: str | None
    point_of_sale_id: str | None
    region_code: str | None
    sales_representative_code: str | None
    retailer_name: str | None
    source_info: str | None
    postal_code: str | None


@dataclass(frozen=True, slots=True)
class TypologyValueRecord:
    id: uuid.UUID
    snapshot_id: uuid.UUID
    category_key: str
    category_name: str
    typology_value: str


@dataclass(frozen=True, slots=True)
class RankRuleRecord:
    id: uuid.UUID
    retailer_name: str
    category_name: str
    category_code: str
    rank: int
    typology_value: str


@dataclass(frozen=True, slots=True)
class MappingRuleRecord:
    id: uuid.UUID
    source_key: str
    raw_retailer_name: str
    raw_category_name: str
    raw_category_code: str | None
    raw_typology_value: str
    mapped_retailer_name: str | None
    mapped_category_code: str | None
    mapped_typology_value: str | None
    has_source_error: bool


@dataclass(frozen=True, slots=True)
class TypologyDataset:
    snapshots: tuple[SnapshotRecord, ...]
    values: tuple[TypologyValueRecord, ...]
    rank_rules: tuple[RankRuleRecord, ...]
    mapping_rules: tuple[MappingRuleRecord, ...]
    rows_read: int


@dataclass(frozen=True, slots=True)
class ImportSummary:
    rows_read: int
    rows_loaded: int
    skipped: bool


class TypologySourceError(ValueError):
    """Raised when typology sources cannot be safely processed."""


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


def normalize_monthly_headers(values: list[str]) -> tuple[str, ...]:
    headers = [normalize_header(value) for value in values]
    if len(headers) > 2 and (headers[2] == "code_client" or headers[2].startswith("code_client_")):
        headers[2] = "source_customer_code"
    return tuple(headers)


def optional_text(value: str | None) -> str | None:
    cleaned = clean_text(value)
    return cleaned or None


def discover_typology_sources(monthly_directory: Path) -> TypologySources:
    if not monthly_directory.is_dir():
        raise TypologySourceError("Typology source must be an existing directory")
    monthly: list[tuple[date, Path]] = []
    periods: set[date] = set()
    for path in sorted(monthly_directory.glob("*.csv")):
        _validate_source_file(path)
        headers, _ = _read_delimited(path, delimiter="|")
        if normalize_monthly_headers(headers) != MONTHLY_COLUMNS:
            raise TypologySourceError("A monthly typology file has an unexpected contract")
        period = _month_from_name(path.name)
        if period in periods:
            raise TypologySourceError("More than one typology file exists for a month")
        periods.add(period)
        monthly.append((period, path))
    if not monthly:
        raise TypologySourceError("Typology source directory contains no monthly CSV files")

    matches: dict[str, list[Path]] = {"aliases": [], "rank_rules": [], "mapping_rules": []}
    for path in sorted(monthly_directory.parent.glob("*.csv")):
        _validate_source_file(path)
        rows = _read_csv_rows(path)
        first = tuple(normalize_header(value) for value in rows[0]) if rows else ()
        second = tuple(normalize_header(value) for value in rows[1]) if len(rows) > 1 else ()
        if first == ALIAS_COLUMNS:
            matches["aliases"].append(path)
        elif first == RANK_COLUMNS:
            matches["rank_rules"].append(path)
        elif second == MAPPING_COLUMNS:
            matches["mapping_rules"].append(path)
    for role, paths in matches.items():
        if len(paths) != 1:
            raise TypologySourceError(f"Exactly one {role} source is required")
    return TypologySources(
        monthly=tuple(monthly),
        aliases=matches["aliases"][0],
        rank_rules=matches["rank_rules"][0],
        mapping_rules=matches["mapping_rules"][0],
    )


def source_bundle_sha256(sources: TypologySources) -> str:
    digest = hashlib.sha256()
    digest.update(f"contract:{IMPORT_CONTRACT_VERSION}".encode())
    entries = [
        *((f"monthly:{period.isoformat()}", path) for period, path in sources.monthly),
        ("aliases", sources.aliases),
        ("rank_rules", sources.rank_rules),
        ("mapping_rules", sources.mapping_rules),
    ]
    for role, path in entries:
        digest.update(role.encode())
        with path.open("rb") as source:
            while chunk := source.read(1024 * 1024):
                digest.update(chunk)
    return digest.hexdigest()


def read_typology_dataset(monthly_directory: Path, stores: list[StoreIdentity]) -> TypologyDataset:
    sources = discover_typology_sources(monthly_directory)
    aliases, alias_rows = _read_aliases(sources.aliases)
    resolver = _StoreResolver(stores, aliases)
    snapshots: list[SnapshotRecord] = []
    values: list[TypologyValueRecord] = []
    seen_source_keys: set[str] = set()
    monthly_rows = 0
    for period, path in sources.monthly:
        file_snapshots, file_values = _read_month(path, period, resolver, seen_source_keys)
        snapshots.extend(file_snapshots)
        values.extend(file_values)
        monthly_rows += len(file_snapshots)
    snapshots = _reconcile_from_observed_store_identity(snapshots, stores)
    rank_rules, rank_rows = _read_rank_rules(sources.rank_rules)
    mapping_rules, mapping_rows = _read_mapping_rules(sources.mapping_rules)
    return TypologyDataset(
        snapshots=tuple(snapshots),
        values=tuple(values),
        rank_rules=tuple(rank_rules),
        mapping_rules=tuple(mapping_rules),
        rows_read=monthly_rows + alias_rows + rank_rows + mapping_rows,
    )


def import_typologies(monthly_directory: Path, engine: Engine | None = None) -> ImportSummary:
    sources = discover_typology_sources(monthly_directory)
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
                    Store.postal_code,
                )
            ).all()
        ]
        if not stores:
            raise TypologySourceError("Stores must be imported before typologies")
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
        dataset = read_typology_dataset(monthly_directory, stores)
        _publish_typologies(database_engine, run_id, dataset)
    except Exception as error:
        _mark_import_failed(database_engine, run_id, error)
        raise
    return ImportSummary(
        rows_read=dataset.rows_read,
        rows_loaded=len(dataset.values),
        skipped=False,
    )


class _StoreResolver:
    def __init__(self, stores: list[StoreIdentity], aliases: dict[str, str]) -> None:
        self.aliases = aliases
        self.lookups: dict[str, dict[str, set[uuid.UUID]]] = {
            name: defaultdict(set)
            for name in ("retail_panel", "external_network", "crm", "erp", "legacy", "data_sharing")
        }
        for store in stores:
            for name, value in (
                ("retail_panel", store.retail_panel_code),
                ("external_network", store.external_network_code),
                ("crm", store.crm_code),
                ("erp", store.erp_code),
                ("legacy", store.legacy_store_id),
                ("data_sharing", store.data_sharing_code),
            ):
                if value:
                    self.lookups[name][normalize_key(value)].add(store.id)

    def resolve(
        self, retail_panel_code: str, customer_code: str
    ) -> tuple[uuid.UUID | None, str, str | None]:
        candidates: list[set[uuid.UUID]] = []
        methods: list[str] = []
        panel_key = normalize_key(retail_panel_code)
        customer_key = normalize_key(customer_code)
        if panel_key and self.lookups["retail_panel"].get(panel_key):
            candidates.append(self.lookups["retail_panel"][panel_key])
            methods.append("retail_panel")
        if customer_key:
            for name in ("external_network", "crm", "erp", "legacy", "data_sharing"):
                if self.lookups[name].get(customer_key):
                    candidates.append(self.lookups[name][customer_key])
                    methods.append(name)
            alias_target = self.aliases.get(customer_key)
            if alias_target and self.lookups["erp"].get(alias_target):
                candidates.append(self.lookups["erp"][alias_target])
                methods.append("alias")
        if not candidates:
            return None, "unresolved", None
        intersection = set.intersection(*candidates)
        union = set.union(*candidates)
        resolved = intersection if len(intersection) == 1 else union if len(union) == 1 else set()
        if len(resolved) == 1:
            return next(iter(resolved)), "matched", "+".join(sorted(set(methods)))
        return None, "conflict", "+".join(sorted(set(methods)))


def _reconcile_from_observed_store_identity(
    snapshots: list[SnapshotRecord], stores: list[StoreIdentity]
) -> list[SnapshotRecord]:
    reference_candidates: dict[tuple[str, str], set[uuid.UUID]] = defaultdict(set)
    for store in stores:
        postal_key = normalize_key(store.postal_code)
        if not postal_key:
            continue
        for name in (store.name, store.legal_name):
            name_key = normalize_key(name)
            if name_key:
                reference_candidates[(name_key, postal_key)].add(store.id)

    observed_candidates: dict[tuple[str, str], set[uuid.UUID]] = defaultdict(set)
    for snapshot in snapshots:
        if snapshot.store_match_status != "matched" or snapshot.store_id is None:
            continue
        source_info_key = normalize_key(snapshot.source_info)
        postal_key = normalize_key(snapshot.postal_code)
        if source_info_key and postal_key:
            observed_candidates[(source_info_key, postal_key)].add(snapshot.store_id)

    reconciled: list[SnapshotRecord] = []
    for snapshot in snapshots:
        if snapshot.store_match_status != "unresolved":
            reconciled.append(snapshot)
            continue
        identity_key = (normalize_key(snapshot.source_info), normalize_key(snapshot.postal_code))
        if not all(identity_key):
            reconciled.append(snapshot)
            continue
        reference_ids = reference_candidates.get(identity_key, set())
        observed_ids = observed_candidates.get(identity_key, set())
        if len(reference_ids) == 1 and reference_ids == observed_ids:
            reconciled.append(
                replace(
                    snapshot,
                    store_id=next(iter(reference_ids)),
                    store_match_status="matched",
                    store_match_method="historical_name_postal",
                )
            )
        else:
            reconciled.append(snapshot)
    return reconciled


def _read_month(
    path: Path,
    period: date,
    resolver: _StoreResolver,
    seen_source_keys: set[str],
) -> tuple[list[SnapshotRecord], list[TypologyValueRecord]]:
    raw_headers, rows = _read_delimited(path, delimiter="|")
    headers = list(normalize_monthly_headers(raw_headers))
    if tuple(headers) != MONTHLY_COLUMNS:
        raise TypologySourceError("A monthly typology file has an unexpected contract")
    snapshots: list[SnapshotRecord] = []
    values: list[TypologyValueRecord] = []
    for row_number, raw_values in enumerate(rows, start=2):
        if len(raw_values) != len(headers):
            raise TypologySourceError(f"Monthly typology row {row_number} has an unexpected width")
        row = dict(zip(headers, raw_values, strict=True))
        panel = clean_text(row["tdlinx"])
        customer = clean_text(row["source_customer_code"])
        point_of_sale = clean_text(row["id_du_point_de_vente"])
        if not (panel or customer or point_of_sale):
            raise TypologySourceError(f"Monthly typology row {row_number} has no source identifier")
        source_key = hashlib.sha256(
            f"{period.isoformat()}|{panel}|{customer}|{point_of_sale}".encode()
        ).hexdigest()
        if source_key in seen_source_keys:
            raise TypologySourceError("A monthly typology source identity is duplicated")
        seen_source_keys.add(source_key)
        snapshot_id = uuid.uuid5(UUID_NAMESPACE, f"snapshot:{source_key}")
        store_id, status, method = resolver.resolve(panel, customer)
        snapshots.append(
            SnapshotRecord(
                id=snapshot_id,
                source_key=source_key,
                period=period,
                store_id=store_id,
                store_match_status=status,
                store_match_method=method,
                retail_panel_code=panel or None,
                source_customer_code=customer or None,
                point_of_sale_id=point_of_sale or None,
                region_code=optional_text(row["dr"]),
                sales_representative_code=optional_text(row["cds"]),
                retailer_name=optional_text(row["nom_de_l_enseigne"]),
                source_info=optional_text(row["info_comp"]),
                postal_code=optional_text(row["cp"]),
            )
        )
        for index, category_key in enumerate(headers[len(BASE_COLUMNS) :], start=len(BASE_COLUMNS)):
            typology_value = clean_text(raw_values[index])
            if not typology_value:
                continue
            values.append(
                TypologyValueRecord(
                    id=uuid.uuid5(UUID_NAMESPACE, f"value:{source_key}:{category_key}"),
                    snapshot_id=snapshot_id,
                    category_key=category_key,
                    category_name=clean_text(raw_headers[index]),
                    typology_value=typology_value,
                )
            )
    return snapshots, values


def _read_aliases(path: Path) -> tuple[dict[str, str], int]:
    rows = _read_csv_rows(path)
    headers = [normalize_header(value) for value in rows[0]]
    if tuple(headers) != ALIAS_COLUMNS:
        raise TypologySourceError("Alias source has an unexpected contract")
    aliases: dict[str, str] = {}
    for values in rows[1:]:
        row = dict(zip(headers, values, strict=True))
        if normalize_key(row["category"]) != "CLIENT":
            continue
        target = normalize_key(row[ALIAS_COLUMNS[-1]])
        for field in ("raw_values", "normalized_id"):
            alias = normalize_key(row[field])
            if not alias or not target:
                continue
            if alias in aliases and aliases[alias] != target:
                raise TypologySourceError("A store alias maps to more than one ERP code")
            aliases[alias] = target
    return aliases, len(rows) - 1


def _read_rank_rules(path: Path) -> tuple[list[RankRuleRecord], int]:
    rows = _read_csv_rows(path)
    headers = [normalize_header(value) for value in rows[0]]
    if tuple(headers) != RANK_COLUMNS:
        raise TypologySourceError("Typology rank source has an unexpected contract")
    records: list[RankRuleRecord] = []
    seen: set[tuple[str, str, int]] = set()
    for values in rows[1:]:
        if not any(clean_text(value) for value in values):
            continue
        row = dict(zip(headers, values, strict=True))
        retailer = clean_text(row["nom_de_l_enseigne"])
        category = clean_text(row["categorie"])
        code = clean_text(row["categorie_court"])
        if not retailer or not category or not code:
            raise TypologySourceError("A typology rank rule is missing its identity")
        for rank in range(1, 13):
            value = clean_text(row[f"typologies_r{rank}"])
            if not value:
                continue
            natural_key = (normalize_key(retailer), normalize_key(code), rank)
            if natural_key in seen:
                raise TypologySourceError("A typology rank is duplicated")
            seen.add(natural_key)
            records.append(
                RankRuleRecord(
                    id=uuid.uuid5(UUID_NAMESPACE, f"rank:{natural_key}"),
                    retailer_name=retailer,
                    category_name=category,
                    category_code=code,
                    rank=rank,
                    typology_value=value,
                )
            )
    return records, len(rows) - 1


def _read_mapping_rules(path: Path) -> tuple[list[MappingRuleRecord], int]:
    rows = _read_csv_rows(path)
    headers = [normalize_header(value) for value in rows[1]] if len(rows) > 1 else []
    if tuple(headers) != MAPPING_COLUMNS:
        raise TypologySourceError("Typology mapping source has an unexpected contract")
    records: list[MappingRuleRecord] = []
    for row_number, values in enumerate(rows[2:], start=3):
        if not any(clean_text(value) for value in values):
            continue
        row = dict(zip(headers, values, strict=True))
        required = ("enseigne", "categorie", "typologie")
        if not all(clean_text(row[field]) for field in required):
            raise TypologySourceError(f"Typology mapping row {row_number} is missing its identity")
        source_key = hashlib.sha256(
            f"{row_number}|{'|'.join(clean_text(value) for value in values)}".encode()
        ).hexdigest()
        records.append(
            MappingRuleRecord(
                id=uuid.uuid5(UUID_NAMESPACE, f"mapping:{source_key}"),
                source_key=source_key,
                raw_retailer_name=clean_text(row["enseigne"]),
                raw_category_name=clean_text(row["categorie"]),
                raw_category_code=optional_text(row["categorie_court"]),
                raw_typology_value=clean_text(row["typologie"]),
                mapped_retailer_name=optional_text(row["correspondance_parmi_les_enseignes"]),
                mapped_category_code=optional_text(
                    row["correspondance_parmi_les_categories_courtes"]
                ),
                mapped_typology_value=optional_text(row["correspondance_parmi_les_typologies"]),
                has_source_error=bool(clean_text(row["error"])),
            )
        )
    return records, len(rows) - 2


def _read_delimited(path: Path, *, delimiter: str) -> tuple[list[str], list[list[str]]]:
    encoding = "utf-16" if path.read_bytes()[:2] in {b"\xff\xfe", b"\xfe\xff"} else "utf-8-sig"
    try:
        with path.open(encoding=encoding, newline="") as source:
            rows = [
                row
                for row in csv.reader(source, delimiter=delimiter)
                if any(clean_text(v) for v in row)
            ]
    except UnicodeDecodeError as error:
        raise TypologySourceError("A typology source has an unsupported encoding") from error
    if not rows:
        raise TypologySourceError("A typology source is empty")
    return rows[0], rows[1:]


def _read_csv_rows(path: Path) -> list[list[str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as source:
            rows = list(csv.reader(source))
    except UnicodeDecodeError as error:
        raise TypologySourceError("A typology helper source has an unsupported encoding") from error
    if not rows:
        raise TypologySourceError("A typology helper source is empty")
    return rows


def _month_from_name(name: str) -> date:
    match = re.match(r"^(\d{4})(\d{2})", name)
    if match is None:
        raise TypologySourceError("Monthly typology filename must start with YYYYMM")
    try:
        return date(int(match.group(1)), int(match.group(2)), 1)
    except ValueError as error:
        raise TypologySourceError("Monthly typology filename contains an invalid month") from error


def _validate_source_file(path: Path) -> None:
    if not path.is_file() or path.suffix.lower() != ".csv":
        raise TypologySourceError("Typology sources must be existing CSV files")
    if path.stat().st_size > MAX_SOURCE_BYTES:
        raise TypologySourceError("A typology source exceeds the 5 MB limit")


def _publish_typologies(engine: Engine, run_id: uuid.UUID, dataset: TypologyDataset) -> None:
    with Session(engine) as session, session.begin():
        session.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:dataset))"),
            {"dataset": DATASET},
        )
        session.execute(select(ImportRun.id).where(ImportRun.id == run_id).with_for_update())
        rank_rule_ids = [record.id for record in dataset.rank_rules]
        mapping_rule_ids = [record.id for record in dataset.mapping_rules]
        stale_rank_rule_ids = list(
            session.scalars(
                select(TypologyRankRule.id).where(TypologyRankRule.id.not_in(rank_rule_ids))
            )
        )
        stale_mapping_rule_ids = list(
            session.scalars(
                select(TypologyMappingRule.id).where(
                    TypologyMappingRule.id.not_in(mapping_rule_ids)
                )
            )
        )
        if stale_rank_rule_ids or stale_mapping_rule_ids:
            referenced_rule = session.scalar(
                select(Assortment.id)
                .where(
                    or_(
                        Assortment.typology_rank_rule_id.in_(stale_rank_rule_ids),
                        Assortment.typology_mapping_rule_id.in_(stale_mapping_rule_ids),
                    )
                )
                .limit(1)
            )
            if referenced_rule is not None:
                raise TypologySourceError(
                    "Typology rules removed from the source are still referenced by assortments"
                )
        session.execute(delete(StoreTypologyValue))
        session.execute(delete(TypologySnapshot))
        _insert_batches(session, TypologySnapshot, dataset.snapshots)
        _insert_batches(session, StoreTypologyValue, dataset.values)
        _upsert_batches(
            session,
            TypologyRankRule,
            dataset.rank_rules,
            ("retailer_name", "category_name", "category_code", "rank", "typology_value"),
        )
        _upsert_batches(
            session,
            TypologyMappingRule,
            dataset.mapping_rules,
            (
                "raw_retailer_name",
                "raw_category_name",
                "raw_category_code",
                "raw_typology_value",
                "mapped_retailer_name",
                "mapped_category_code",
                "mapped_typology_value",
                "has_source_error",
            ),
        )
        if stale_rank_rule_ids:
            session.execute(
                delete(TypologyRankRule).where(TypologyRankRule.id.in_(stale_rank_rule_ids))
            )
        if stale_mapping_rule_ids:
            session.execute(
                delete(TypologyMappingRule).where(
                    TypologyMappingRule.id.in_(stale_mapping_rule_ids)
                )
            )
        session.execute(
            update(ImportRun)
            .where(ImportRun.id == run_id)
            .values(
                status=ImportStatus.SUCCEEDED.value,
                rows_read=dataset.rows_read,
                rows_inserted=len(dataset.values),
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


def _upsert_batches(
    session: Session,
    model: Any,
    records: tuple[Any, ...],
    update_columns: tuple[str, ...],
) -> None:
    for offset in range(0, len(records), DATABASE_BATCH_SIZE):
        statement = insert(model)
        session.execute(
            statement.on_conflict_do_update(
                index_elements=["id"],
                set_={column: getattr(statement.excluded, column) for column in update_columns},
            ),
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
