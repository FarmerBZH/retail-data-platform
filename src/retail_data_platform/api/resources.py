from __future__ import annotations

import json
from dataclasses import dataclass
from importlib.resources import files
from typing import Any

from pydantic import BaseModel, ConfigDict, create_model
from sqlalchemy import Table
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from retail_data_platform.database import models  # noqa: F401
from retail_data_platform.database.analytics import AnalyticsBase
from retail_data_platform.database.base import Base


@dataclass(frozen=True)
class Resource:
    name: str
    table: Table
    columns: tuple[str, ...]
    operations: bool
    row_model: type[BaseModel]
    page_model: type[BaseModel]

    @property
    def keys(self) -> tuple[str, ...]:
        return tuple(c.name for c in self.table.primary_key)

    @property
    def filters(self) -> tuple[str, ...]:
        available = [
            name for name in ("id", "store_id", "product_id", "period") if name in self.columns
        ]
        available.extend(key for key in self.keys if key not in available)
        if self.name in {"stores", "store_typology_values"}:
            available.append("store_id")
        return tuple(available)


def load_resources() -> dict[str, Resource]:
    manifest = json.loads(files(__package__).joinpath("resources.json").read_text())
    tables = {**Base.metadata.tables, **AnalyticsBase.metadata.tables}
    resources = {}
    rows: dict[str, type[BaseModel]] = {}
    nested = {
        "current_store": "stores",
        "activity_details": "analytics_activity_month",
        "category_details": "analytics_store_category_month",
        "typology_details": "analytics_typology_month",
    }

    def row_for(name: str) -> type[BaseModel]:
        if name in rows:
            return rows[name]
        fields: dict[str, Any] = {}
        table = tables[name]
        for name_ in manifest[name]["columns"]:
            column = table.c[name_]
            datatype: Any
            if isinstance(column.type, ARRAY):
                datatype = list[column.type.item_type.python_type]  # type: ignore[name-defined]
            elif isinstance(column.type, JSONB):
                source = row_for(nested[name_])
                nested_fields: dict[str, Any] = {
                    key: (field.annotation, ...)
                    for key, field in source.model_fields.items()
                    if name_ == "current_store" or key not in {"store_id", "period"}
                }
                nested_model: Any = create_model(
                    name_, __config__=ConfigDict(extra="ignore"), **nested_fields
                )
                datatype = nested_model if name_ == "current_store" else list[nested_model]
            else:
                datatype = column.type.python_type
            if column.nullable:
                datatype = datatype | None
            fields[name_] = (datatype, ...)
        rows[name] = create_model(name + "_row", __config__=ConfigDict(extra="forbid"), **fields)
        return rows[name]

    for name, spec in manifest.items():
        row = row_for(name)
        row_type: Any = row
        page = create_model(
            name + "_page", items=(list[row_type], ...), next_cursor=(str | None, ...)
        )
        resources[name] = Resource(
            name, tables[name], tuple(spec["columns"]), spec["operations"], row, page
        )
    return resources


RESOURCES = load_resources()
