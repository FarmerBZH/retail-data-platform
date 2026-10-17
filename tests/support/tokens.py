"""Synthetic signed access tokens shared by API and authentication tests."""

from __future__ import annotations

import time
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import rsa


def token(key: rsa.RSAPrivateKey, **claims: Any) -> str:
    now = int(time.time())
    payload = {
        "iss": "https://identity.example.test",
        "aud": "retail-api",
        "sub": "synthetic",
        "iat": now,
        "auth_time": now,
        "azp": "retail-personal",
        "exp": now + 300,
        "scope": "data:read",
        **claims,
    }
    return jwt.encode(payload, key, algorithm="RS256", headers={"typ": "at+jwt", "kid": "test"})
