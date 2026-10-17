"""Regression checks for disposable smoke process cleanup, without provider credentials."""

from __future__ import annotations

import contextlib
import importlib.util
import os
import select
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock, patch

import pytest


def smoke_module() -> ModuleType:
    path = Path(__file__).resolve().parent.parent / "scripts/smoke-browser-identity.py"
    spec = importlib.util.spec_from_file_location("browser_smoke", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.skipif(os.name != "posix", reason="Local smoke uses POSIX process sessions")
@pytest.mark.parametrize("leader_exits", [False, True])
def test_stop_removes_descendants_even_after_leader_exit(leader_exits: bool) -> None:
    child = (
        "import signal,socket,time; "
        "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
        "s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(); "
        "print(s.getsockname()[1],flush=True); time.sleep(60)"
    )
    parent = (
        "import subprocess,sys,time; "
        f"p=subprocess.Popen([sys.executable,'-c',{child!r}],stdout=subprocess.PIPE); "
        "print(p.stdout.readline().decode().strip(),flush=True); "
        + ("sys.exit(0)" if leader_exits else "time.sleep(60)")
    )
    process = subprocess.Popen(
        [sys.executable, "-c", parent], stdout=subprocess.PIPE, start_new_session=True
    )
    try:
        assert process.stdout is not None
        assert select.select([process.stdout], [], [], 5)[0], "Synthetic child did not start"
        port = int(process.stdout.readline())
        if leader_exits:
            process.wait(timeout=5)
        smoke_module().stop(process)
        # A child ignoring SIGTERM must release its listener before cleanup returns.
        deadline = time.monotonic() + 2
        while True:
            try:
                with socket.socket() as listener:
                    listener.bind(("127.0.0.1", port))
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(0.01)
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)
        process.wait(timeout=5)
        if process.stdout is not None:
            process.stdout.close()


def test_stop_failure_does_not_skip_remaining_services() -> None:
    module = smoke_module()
    api, frontend, browser = Mock(), Mock(), Mock()
    with patch.object(
        module, "stop", side_effect=[RuntimeError("Synthetic failure"), None, None]
    ) as stop:
        with pytest.raises(RuntimeError, match="Synthetic failure"):
            module.stop_all([api, frontend, browser])
        assert [call.args[0] for call in stop.call_args_list] == [browser, frontend, api]
