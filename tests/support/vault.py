"""In-memory test vault; never a production credential backend."""

from __future__ import annotations

from keyring.backend import KeyringBackend


class MemoryVault(KeyringBackend):
    """Test-only synthetic vault, never installed as a production fallback."""

    priority = 1

    def __init__(self) -> None:
        self.values: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self.values.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self.values[service, username] = password

    def delete_password(self, service: str, username: str) -> None:
        self.values.pop((service, username), None)
