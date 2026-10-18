"""Synthetic fact factories shared by analytical contract tests."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from retail_data_platform.database.models import (
    Assortment,
    NumericDistributionObservation,
    Product,
    RegisterObservation,
    ShelfShareObservation,
    Store,
    StoreActivityMetric,
    StoreTypologyValue,
    TypologyRankRule,
    TypologySnapshot,
)

JAN = date(2025, 1, 1)
FEB = date(2025, 2, 1)
MAR = date(2025, 3, 1)


def store(session: Session, suffix: str = "one") -> Store:
    result = Store(id=uuid.uuid4(), source_key=f"synthetic-{suffix}", name=f"Synthetic {suffix}")
    session.add(result)
    session.flush()
    return result


def product(session: Session, gtin: str = "1000000000001") -> Product:
    result = Product(id=uuid.uuid4(), gtin=gtin, internal_code=gtin, name="Synthetic product")
    session.add(result)
    session.flush()
    return result


def register(
    session: Session,
    s: Store | None,
    p: Product,
    period: date = JAN,
    revenue: Decimal | None = Decimal("10"),
    units: int | None = 2,
    kind: str = "monthly",
) -> RegisterObservation:
    result = RegisterObservation(
        id=uuid.uuid4(),
        period=period,
        source_kind=kind,
        source_store_reference="synthetic-reference",
        store_id=s.id if s else None,
        store_match_status="matched" if s else "unresolved",
        store_match_method="synthetic" if s else None,
        source_gtin=p.gtin,
        product_id=p.id,
        product_match_status="matched",
        revenue_value=revenue,
        units_sold=units,
    )
    session.add(result)
    session.flush()
    return result


def activity(session: Session, s: Store, count: int, kind: str = "calls") -> None:
    session.add(
        StoreActivityMetric(
            id=uuid.uuid4(),
            source_key=uuid.uuid4().hex.ljust(64, "0"),
            period=JAN,
            store_id=s.id,
            store_match_status="matched",
            store_match_method="synthetic",
            activity_type=kind,
            activity_count=count,
            source_store_reference="synthetic",
            source_store_label="Synthetic store",
        )
    )
    session.flush()


def distribution(
    session: Session,
    s: Store,
    p: Product,
    presence: int,
    category: str = "CAT-A",
    *,
    origin: str | None = None,
) -> None:
    session.add(
        NumericDistributionObservation(
            id=uuid.uuid4(),
            source_key=uuid.uuid4().hex.ljust(64, "0"),
            period=JAN,
            category_code=category,
            store_id=s.id,
            store_match_status="matched",
            store_match_method="synthetic",
            product_id=p.id,
            product_match_status="matched",
            product_match_method="synthetic",
            presence_value=presence,
            value_origin=origin or ("reported" if presence else "inferred_absence"),
            source_category_name="Synthetic category",
            source_store_reference="synthetic",
            source_store_label="Synthetic store",
            source_product_reference=p.gtin,
            source_product_label="Synthetic product",
        )
    )
    session.flush()


def shelf(session: Session, s: Store, company: int, total: int, category: str) -> None:
    session.add(
        ShelfShareObservation(
            id=uuid.uuid4(),
            source_key=uuid.uuid4().hex.ljust(64, "0"),
            period=JAN,
            category_code=category,
            store_id=s.id,
            store_match_status="matched",
            store_match_method="synthetic",
            company_value=company,
            total_value=total,
            share=Decimal(company) / total if total else None,
            source_row_count=1,
            source_category_name="Synthetic category",
            source_store_reference="synthetic",
            source_store_label="Synthetic store",
        )
    )
    session.flush()


def typology(
    session: Session, s: Store, value: str = "T1", period: date = JAN
) -> StoreTypologyValue:
    snapshot = TypologySnapshot(
        id=uuid.uuid4(),
        source_key=uuid.uuid4().hex.ljust(64, "0"),
        period=period,
        store_id=s.id,
        store_match_status="matched",
        store_match_method="synthetic",
        retailer_name="Synthetic retailer",
        region_code="Historical region",
    )
    session.add(snapshot)
    session.flush()
    v = StoreTypologyValue(
        id=uuid.uuid4(),
        snapshot_id=snapshot.id,
        category_key="synthetic_category",
        category_name="Synthetic category",
        typology_value=value,
    )
    session.add(v)
    session.flush()
    return v


def rank_assortment(session: Session, p: Product, value: str = "T1", rank: int = 1) -> Assortment:
    r = TypologyRankRule(
        id=uuid.uuid4(),
        retailer_name="Synthetic retailer",
        category_name="Synthetic category",
        category_code="CAT-A",
        rank=rank,
        typology_value=value,
    )
    session.add(r)
    session.flush()
    a = Assortment(
        id=uuid.uuid4(),
        source_key=uuid.uuid4().hex.ljust(64, "0"),
        period=JAN,
        product_id=p.id,
        product_match_status="matched",
        typology_rank_rule_id=r.id,
        typology_match_status="matched",
        typology_match_method="product_category",
        source_retailer_name="Synthetic retailer",
        source_category_name="Synthetic category",
        source_product_name="Synthetic product",
        gtin=p.gtin,
        source_typology_value=value,
    )
    session.add(a)
    session.flush()
    return a
