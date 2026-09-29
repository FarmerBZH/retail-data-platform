from __future__ import annotations

import hashlib
import threading
import time

from fastapi import HTTPException


class ReadBudget:
    """Bounded per-process subject budget; ingress owns distributed rate limiting."""

    def __init__(self) -> None:
        self.entries: dict[str, tuple[float, int]] = {}
        self.lock = threading.Lock()

    def consume(self, subject: str) -> None:
        key = hashlib.sha256(subject.encode()).hexdigest()
        now = time.monotonic()
        with self.lock:
            entry = self.entries.get(key)
            if entry is None or entry[0] <= now:
                if len(self.entries) >= 4096:
                    self.entries = {k: v for k, v in self.entries.items() if v[0] > now}
                if key not in self.entries and len(self.entries) >= 4096:
                    raise HTTPException(503, "capacity_exceeded", headers={"Retry-After": "60"})
                entry = (now + 60, 0)
            if entry[1] >= 120:
                raise HTTPException(429, "rate_limited", headers={"Retry-After": "60"})
            self.entries[key] = (entry[0], entry[1] + 1)
