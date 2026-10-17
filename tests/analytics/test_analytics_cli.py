from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from retail_data_platform import cli
from retail_data_platform.analytics import AnalyticsRefreshError


@pytest.mark.parametrize("refresh", [False, True])
def test_import_refresh_opt_in_also_runs_after_skipped_import(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    refresh: bool,
) -> None:
    steps: list[str] = []

    def fake_import(path: Path) -> SimpleNamespace:
        steps.append("import")
        return SimpleNamespace(rows_read=0, rows_loaded=0, skipped=True)

    def fake_refresh(**kwargs: Any) -> None:
        steps.append("refresh")

    monkeypatch.setattr(cli, "import_products", fake_import)
    monkeypatch.setattr(cli, "refresh_analytics", fake_refresh)
    monkeypatch.setattr(cli, "analytics_status", lambda: {"state": "current"})
    args = ["retail-data", "import", "products", "--source-dir", "synthetic"]
    if refresh:
        args.append("--refresh-analytics")
    monkeypatch.setattr("sys.argv", args)
    assert cli.main() == 0
    assert steps == (["import", "refresh"] if refresh else ["import"])
    assert '"skipped": true' in capsys.readouterr().out


def test_refresh_failure_is_nonzero_and_does_not_repeat_import(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    calls: list[str] = []

    def fake_import(path: Path) -> SimpleNamespace:
        calls.append("import")
        return SimpleNamespace(rows_read=0, rows_loaded=0, skipped=False)

    def fake_refresh(**kwargs: Any) -> None:
        calls.append("refresh")
        raise AnalyticsRefreshError("Synthetic refresh failure")

    monkeypatch.setattr(cli, "import_products", fake_import)
    monkeypatch.setattr(cli, "refresh_analytics", fake_refresh)
    monkeypatch.setattr(
        "sys.argv",
        [
            "retail-data",
            "import",
            "products",
            "--source-dir",
            "synthetic",
            "--refresh-analytics",
        ],
    )
    assert cli.main() == 1
    assert calls == ["import", "refresh"]
    assert '"status": "failed"' in capsys.readouterr().out
