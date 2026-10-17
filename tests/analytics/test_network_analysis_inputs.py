"""Pure domain validation; no source data, SQL connection or API dependency."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

import pytest

from retail_data_platform.database.network_analysis import (
    AnalysisInputError,
    RankKey,
    Scope,
    Window,
)


@pytest.mark.parametrize(
    "values",
    [
        {"mode": "other"},
        {"mode": "selection"},
        {"store_ids": (UUID(int=1),)},
        {"mode": "selection", "store_ids": (UUID(int=1), UUID(int=1))},
        {"mode": "selection", "store_ids": tuple(UUID(int=i) for i in range(101))},
        {"mode": "selection", "store_ids": ("private-value",)},
        {"activity_status": "unknown"},
        {"retailer_name": "x" * 129},
        {"region_code": "x" * 33},
        {"store_format": 123},
    ],
)
def test_invalid_scope_fails_without_echoing_values(values: dict[str, Any]) -> None:
    with pytest.raises(AnalysisInputError) as error:
        Scope(**values)
    assert str(error.value) in {"invalid_scope", "invalid_filter"}
    assert "private-value" not in str(error.value)


def test_windows_have_inclusive_calendar_reference_and_overlap() -> None:
    window = Window(date(2025, 11, 1), date(2026, 2, 1))
    assert window.months == 4
    assert window.reference("previous") == Window(date(2025, 7, 1), date(2025, 10, 1))
    assert window.reference("previous_year") == Window(date(2024, 11, 1), date(2025, 2, 1))
    assert Window(date(2025, 1, 1), date(2034, 12, 1)).months == 120
    assert Window(date(2025, 1, 1), date(2026, 1, 1)).reference("previous_year").end == date(
        2025, 1, 1
    )


@pytest.mark.parametrize(
    "start,end",
    [
        (date(2025, 2, 2), date(2025, 3, 1)),
        (date(2025, 2, 1), date(2025, 1, 1)),
        (date(2025, 1, 1), date(2035, 1, 1)),
        (datetime(2025, 1, 1), date(2025, 3, 1)),
    ],
)
def test_invalid_month_or_window(start: date, end: date) -> None:
    with pytest.raises(AnalysisInputError):
        Window(start, end)


def test_references_do_not_wrap_before_first_year() -> None:
    with pytest.raises(AnalysisInputError, match="invalid_reference_window"):
        Window(date(1, 1, 1), date(1, 1, 1)).reference("previous")
    with pytest.raises(AnalysisInputError, match="invalid_reference_window"):
        Window(date(1, 12, 1), date(1, 12, 1)).reference("previous_year")


@pytest.mark.parametrize("value", [Decimal("NaN"), Decimal("Infinity"), Decimal("1e513")])
def test_rank_key_bounds_exact_decimals(value: Decimal) -> None:
    with pytest.raises(AnalysisInputError, match="invalid_rank_key"):
        RankKey(value, UUID(int=1))
