from __future__ import annotations

import base64
import binascii
import json
from datetime import date
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError, model_validator
from sqlalchemy import select, tuple_
from sqlalchemy.sql import Select

from retail_data_platform.api.resources import RESOURCES, Resource


class Query(BaseModel):
    model_config = ConfigDict(extra="forbid")
    limit: int = Field(default=50, ge=1, le=200)
    after: str | None = Field(default=None, max_length=8192)
    id: UUID | None = None
    store_id: UUID | None = None
    product_id: UUID | None = None
    assortment_id: UUID | None = None
    typology_value_id: UUID | None = None
    scope: str | None = Field(default=None, max_length=32)
    activity_type: str | None = Field(default=None, max_length=32)
    category_code: str | None = Field(default=None, max_length=32)
    product_key: str | None = Field(default=None, max_length=1024)
    source_gtin: str | None = Field(default=None, max_length=14)
    dataset: str | None = Field(default=None, max_length=1024)
    store_match_status: str | None = Field(default=None, max_length=16)
    period_from: date | None = None
    period_to: date | None = None

    @model_validator(mode="after")
    def months(self) -> Query:
        if any(value and value.day != 1 for value in (self.period_from, self.period_to)):
            raise ValueError("Periods must be first-of-month dates")
        if self.period_from and self.period_to and self.period_from > self.period_to:
            raise ValueError("Invalid period range")
        return self

    def context(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude={"limit", "after"}, exclude_none=True)


def cursor_for(resource: Resource, query: Query, row: dict[str, Any]) -> str:
    value = {
        "resource": resource.name,
        "filters": query.context(),
        "keys": [str(row[key]) for key in resource.keys],
    }
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def statement_for(resource: Resource, query: Query) -> Select[Any]:
    table = resource.table
    statement = select(*(table.c[name] for name in resource.columns))
    for key in query.context():
        field = "period" if key.startswith("period_") else key
        if field not in resource.filters:
            raise HTTPException(422, "unsupported_filter")
        if key == "store_id" and resource.name == "store_typology_values":
            snapshots = RESOURCES["typology_snapshots"].table
            statement = statement.where(
                table.c.snapshot_id.in_(
                    select(snapshots.c.id).where(snapshots.c.store_id == query.store_id)
                )
            )
            continue
        if key == "store_id" and resource.name == "stores":
            field = "id"
        typed_value = getattr(query, key)
        if key == "period_from":
            statement = statement.where(table.c[field] >= typed_value)
        elif key == "period_to":
            statement = statement.where(table.c[field] <= typed_value)
        else:
            statement = statement.where(table.c[field] == typed_value)
    keys = [table.c[key] for key in resource.keys]
    if query.after:
        try:
            value = json.loads(base64.b64decode(query.after, altchars=b"-_", validate=True))
            if (
                not isinstance(value, dict)
                or set(value) != {"resource", "filters", "keys"}
                or value["resource"] != resource.name
                or value["filters"] != query.context()
                or not isinstance(value["keys"], list)
                or len(value["keys"]) != len(keys)
                or any(not isinstance(v, str) or len(v) > 1024 for v in value["keys"])
            ):
                raise ValueError()
            converted = [
                TypeAdapter(col.type.python_type).validate_python(v)
                for col, v in zip(keys, value["keys"], strict=True)
            ]
        except (ValueError, TypeError, KeyError, binascii.Error, ValidationError):
            raise HTTPException(422, "invalid_cursor") from None
        statement = statement.where(tuple_(*keys) > tuple_(*converted))
    return statement.order_by(*keys).limit(query.limit + 1)
