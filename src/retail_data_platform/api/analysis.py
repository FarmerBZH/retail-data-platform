"""Authenticated adapters over the T24 SQL reader; no administrative actions."""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
from collections.abc import Callable
from datetime import date
from decimal import Decimal
from typing import Annotated, Any, Literal, cast
from uuid import UUID

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import Connection, select, text

from retail_data_platform.analytics import ANALYTICAL_VIEWS
from retail_data_platform.api import analysis_models as m
from retail_data_platform.api.database import analysis_connection
from retail_data_platform.database.models import AnalyticsRefreshRun, ImportRun
from retail_data_platform.database.network_analysis import (
    DATASETS,
    MEASURES,
    AnalysisInputError,
    AnalysisReader,
    RankKey,
    Window,
)

PREFIX = "/v1/analytics/analysis"


def publication(connection: Connection, requested: UUID | None) -> dict[str, Any]:
    """Resolve identity and freshness in the same snapshot as the business reads."""
    successful = connection.execute(
        select(
            AnalyticsRefreshRun.id,
            AnalyticsRefreshRun.completed_at,
            AnalyticsRefreshRun.source_run_ids,
        )
        .where(AnalyticsRefreshRun.status == "succeeded")
        .order_by(AnalyticsRefreshRun.completed_at.desc(), AnalyticsRefreshRun.id)
        .limit(1)
    ).first()
    populated = dict(
        connection.execute(
            text(
                "SELECT matviewname, ispopulated FROM pg_matviews WHERE schemaname=current_schema()"
            )
        )
        .tuples()
        .all()
    )
    if successful is None or not all(populated.get(name, False) for name in ANALYTICAL_VIEWS):
        raise HTTPException(503, "analytics_uninitialized", headers={"Retry-After": "5"})
    if requested is not None and requested != successful.id:
        raise HTTPException(409, "publication_changed")
    source_ids = list(
        connection.scalars(
            select(ImportRun.id).where(ImportRun.status == "succeeded").order_by(ImportRun.id)
        )
    )
    latest = connection.scalar(
        select(AnalyticsRefreshRun.status)
        .order_by(AnalyticsRefreshRun.started_at.desc(), AnalyticsRefreshRun.id)
        .limit(1)
    )
    return {
        "publication_id": successful.id,
        "freshness": {
            "state": "current" if successful.source_run_ids == source_ids else "stale",
            "last_completed_at": successful.completed_at,
            "last_attempt_status": latest,
        },
    }


def _fingerprint(route: str, query: m.AnalysisQuery) -> str:
    context = query.model_dump(mode="json", exclude={"after", "limit", "publication_id"})
    context["store_ids"] = sorted(context["store_ids"])
    content = json.dumps([route, context], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(content.encode()).hexdigest()


def _cursor(route: str, query: m.AnalysisQuery, pub: UUID, key: dict[str, Any]) -> str:
    content = {"context": _fingerprint(route, query), "publication_id": str(pub), "key": key}
    return base64.urlsafe_b64encode(json.dumps(content, separators=(",", ":")).encode()).decode()


def _decode(route: str, query: m.AnalysisQuery) -> Any:
    encoded = getattr(query, "after", None)
    if encoded is None:
        return None
    try:
        if query.publication_id is None:
            raise ValueError()
        value = json.loads(base64.b64decode(encoded, altchars=b"-_", validate=True))
        if (
            not isinstance(value, dict)
            or set(value) != {"context", "publication_id", "key"}
            or value["context"] != _fingerprint(route, query)
            or value["publication_id"] != str(query.publication_id)
            or not isinstance(value["key"], dict)
        ):
            raise ValueError()
        key = value["key"]
        if route == "dimensions":
            if set(key) != {"value"} or not isinstance(key["value"], str):
                raise ValueError()
            if len(key["value"]) > 128:
                raise ValueError()
            return key["value"]
        expected = {"store_id", "value"} if route == "ranking" else {"store_id"}
        if set(key) != expected or not isinstance(key["store_id"], str):
            raise ValueError()
        sid = UUID(key["store_id"])
        if route == "ranking":
            val = key["value"]
            if val is not None and (not isinstance(val, str) or len(val) > 2048):
                raise ValueError()
            return RankKey(Decimal(val) if val is not None else None, sid)
        return sid
    except (ValueError, TypeError, KeyError, binascii.Error, ArithmeticError, RecursionError):
        raise HTTPException(422, "invalid_cursor") from None


def _window(query: m.AnalysisQuery) -> Window | None:
    start, end = getattr(query, "period_from", None), getattr(query, "period_to", None)
    return Window(start, end) if start is not None and end is not None else None


def _context(query: m.AnalysisQuery, reader: AnalysisReader, pub: dict[str, Any]) -> dict[str, Any]:
    window = _window(query)
    comparison = getattr(query, "comparison", "previous") if window else None
    reference = (
        window.reference(cast(Literal["previous", "previous_year"], comparison)) if window else None
    )
    return {
        **pub,
        "scope": {
            **query.model_dump(
                include=set(m.AnalysisQuery.model_fields), exclude={"publication_id"}
            ),
            "store_ids": sorted(query.store_ids),
            **reader.counts,
        },
        "window": {"start": window.start, "end": window.end, "months": window.months}
        if window
        else None,
        "reference": {"start": reference.start, "end": reference.end, "months": reference.months}
        if reference
        else None,
        "comparison": comparison,
    }


def _measure(row: dict[str, Any], prefix: str, expected: int) -> dict[str, Any]:
    return {
        "value": row[prefix],
        "partial": row[prefix + "_partial"],
        "covered_cell_count": row[prefix + "_covered_cell_count"],
        "expected_cell_count": expected,
    }


def _change(row: dict[str, Any], prefix: str) -> dict[str, Any]:
    return {
        "difference": row[prefix + "_change"],
        "ratio": row[prefix + "_change_ratio"],
        "reference_state": row[prefix + "_reference_state"],
    }


def _summary(reader: AnalysisReader) -> dict[str, Any]:
    row = reader.summary()
    metrics = {}
    for metric in MEASURES:
        cohort = "cohort_" + metric
        metrics[metric] = {
            "current": _measure(row, "current_" + metric, row["expected_cell_count"]),
            "reference": _measure(row, "reference_" + metric, row["expected_cell_count"]),
            "change": _change(row, metric),
            "cohort": {
                "store_count": row[cohort + "_store_count"],
                "excluded_store_count": row[cohort + "_excluded_store_count"],
                "expected_cell_count": row[cohort + "_expected_cell_count"],
                "current": row[cohort + "_current"],
                "reference": row[cohort + "_reference"],
                "change": _change(row, cohort),
            },
        }
    return {
        "metrics": metrics,
        "revenue_per_unit": {
            "current": row["current_revenue_per_unit"],
            "reference": row["reference_revenue_per_unit"],
            "cohort_current": row["cohort_current_revenue_per_unit"],
            "cohort_reference": row["cohort_reference_revenue_per_unit"],
            "cohort_store_count": row["unit_revenue_cohort_store_count"],
        },
        "revenue_contribution_sum": row["revenue_contribution_sum"],
    }


def _point(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "period": row["period"],
        "reference_period": row["reference_period"],
        "metrics": {
            metric: {
                "current": _measure(row, "current_" + metric, row["expected_cell_count"]),
                "reference": _measure(row, "reference_" + metric, row["expected_cell_count"]),
                "cohort_store_count": row["cohort_" + metric + "_store_count"],
                "cohort_current": row["cohort_current_" + metric],
                "cohort_reference": row["cohort_reference_" + metric],
            }
            for metric in MEASURES
        },
    }


def _availability(reader: AnalysisReader, window: Window | None) -> dict[str, Any]:
    bounds = {row["dataset"]: row for row in reader.availability_bounds()}
    observed = {(r["dataset"], r["period"]): r for r in reader.availability()} if window else {}
    periods: list[date] = []
    if window:
        for offset in range(window.months):
            index = window.start.year * 12 + window.start.month - 1 + offset
            periods.append(date(index // 12, index % 12 + 1, 1))
    return {
        "items": [
            {
                "dataset": dataset,
                "first_period": bounds.get(dataset, {}).get("first_period"),
                "last_period": bounds.get(dataset, {}).get("last_period"),
                "months": [
                    {
                        "period": period,
                        "has_observation": (dataset, period) in observed,
                        **{
                            field: observed.get((dataset, period), {}).get(field)
                            for field in (
                                "source_row_count",
                                "observed_row_count",
                                "inferred_absence_row_count",
                                "observed_store_count",
                            )
                        },
                    }
                    for period in periods
                ],
            }
            for dataset in DATASETS
        ]
    }


def _data(
    route: str, query: m.AnalysisQuery, reader: AnalysisReader, pub: UUID, after: Any
) -> dict[str, Any]:
    if route == "summary":
        return _summary(reader)
    if route == "series":
        return {"items": [_point(row) for row in reader.series()]}
    if route == "availability":
        return _availability(reader, _window(query))
    assert isinstance(query, (m.StoresQuery, m.RankingQuery, m.StoreSeriesQuery))
    limit = query.limit
    if isinstance(query, m.DimensionsQuery):
        rows = reader.dimensions_page(query.dimension, query=query.q, after=after, limit=limit)
        return {
            "items": rows[:limit],
            "next_cursor": _cursor(route, query, pub, rows[limit - 1])
            if len(rows) > limit
            else None,
            "dimension": query.dimension,
            "missing_store_count": reader.dimension_missing_count(query.dimension),
        }
    if isinstance(query, m.StoresQuery):
        rows = reader.stores_page(query=query.q, after=after, limit=limit)
    elif isinstance(query, m.RankingQuery):
        rows = reader.ranking(sort=query.sort, direction=query.direction, after=after, limit=limit)
    else:
        # Discover only one extra ID, never its potentially 120 business points.
        stores = reader.stores_page(after=after, limit=limit)
        points = reader.store_series(after=after, limit=limit)
        return {
            "items": [
                {
                    "store": store,
                    "points": [
                        _point(row) for row in points if row["store_id"] == store["store_id"]
                    ],
                }
                for store in stores[:limit]
            ],
            "next_cursor": _cursor(
                route, query, pub, {"store_id": str(stores[limit - 1]["store_id"])}
            )
            if len(stores) > limit
            else None,
        }
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        key: dict[str, Any] = {"store_id": str(last["store_id"])}
        if route == "ranking":
            key["value"] = str(last["sort_value"]) if last["sort_value"] is not None else None
        next_cursor = _cursor(route, query, pub, key)
    items = [
        {key: value for key, value in row.items() if key != "sort_value"} for row in rows[:limit]
    ]
    return {"items": items, "next_cursor": next_cursor}


def serve(
    request: Request, route: str, query: m.AnalysisQuery, response_type: type[BaseModel]
) -> Response:
    if any(
        len(request.query_params.getlist(key)) > 1
        for key in request.query_params
        if key != "store_ids"
    ):
        raise HTTPException(422, "invalid_query")
    after = _decode(route, query)
    try:
        with analysis_connection(request.app.state.engine) as connection:
            pub = publication(connection, query.publication_id)
            reader = AnalysisReader(
                connection,
                query.domain_scope(),
                _window(query),
                getattr(query, "comparison", "previous"),
            )
            result = response_type.model_validate(
                {
                    "context": _context(query, reader, pub),
                    **_data(route, query, reader, pub["publication_id"], after),
                }
            )
        encoded = result.model_dump_json().encode()
        if len(encoded) > request.app.state.settings.response_bytes:
            raise HTTPException(413, "response_too_large_reduce_limit_or_window")
        return Response(encoded, media_type="application/json")
    except AnalysisInputError:
        raise HTTPException(422, "invalid_analysis_query") from None


def install_analysis_routes(app: FastAPI, authenticate: Callable[..., Any]) -> None:
    router = APIRouter(
        prefix=PREFIX,
        dependencies=[Depends(authenticate)],
        tags=["Filtered analysis"],
        responses={
            status: {"model": m.ErrorResponse, "description": description}
            for status, description in {
                401: "Personal authentication required or invalid",
                403: "Required data:read scope absent",
                409: "Successful analytical publication changed",
                413: "Encoded response exceeds configured limit",
                414: "Query string exceeds configured limit",
                422: "Invalid query, cursor or analysis scope",
                429: "Per-subject read budget exhausted",
                500: "Unexpected internal failure without private details",
                503: "Database, initial publication or service capacity unavailable",
            }.items()
        },
    )

    @router.get("/stores", response_model=m.Page[m.StoreItem])
    def stores(request: Request, query: Annotated[m.StoresQuery, Query()]) -> Response:
        return serve(request, "stores", query, m.Page[m.StoreItem])

    @router.get("/dimensions", response_model=m.DimensionPage)
    def dimensions(request: Request, query: Annotated[m.DimensionsQuery, Query()]) -> Response:
        return serve(request, "dimensions", query, m.DimensionPage)

    @router.get("/availability", response_model=m.Availability)
    def availability(request: Request, query: Annotated[m.AvailabilityQuery, Query()]) -> Response:
        return serve(request, "availability", query, m.Availability)

    @router.get("/summary", response_model=m.Summary)
    def summary(request: Request, query: Annotated[m.WindowQuery, Query()]) -> Response:
        return serve(request, "summary", query, m.Summary)

    @router.get("/series", response_model=m.Series)
    def series(request: Request, query: Annotated[m.WindowQuery, Query()]) -> Response:
        return serve(request, "series", query, m.Series)

    @router.get("/ranking", response_model=m.Page[m.RankingItem])
    def ranking(request: Request, query: Annotated[m.RankingQuery, Query()]) -> Response:
        return serve(request, "ranking", query, m.Page[m.RankingItem])

    @router.get("/store-series", response_model=m.Page[m.StoreSeries])
    def store_series(request: Request, query: Annotated[m.StoreSeriesQuery, Query()]) -> Response:
        return serve(request, "store-series", query, m.Page[m.StoreSeries])

    app.include_router(router)
