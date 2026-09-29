from __future__ import annotations

import sys

from keyring.backend import KeyringBackend

SERVICE = "retail-data-platform.personal-session.v1"


def system_vault() -> KeyringBackend:
    # Instantiate native backends explicitly: never use plaintext or plugin fallbacks.
    if sys.platform == "darwin":
        from keyring.backends.macOS import Keyring

        return Keyring()  # type: ignore[no-untyped-call]
    if sys.platform == "win32":
        from keyring.backends.Windows import WinVaultKeyring

        return WinVaultKeyring()
    if sys.platform.startswith("linux"):
        from keyring.backends.SecretService import Keyring as SecretServiceKeyring

        return SecretServiceKeyring()
    raise RuntimeError("A supported OS credential vault is required")


def erase(vault: KeyringBackend, account: str) -> None:
    if vault.get_password(SERVICE, account) is not None:
        vault.delete_password(SERVICE, account)
