"""Public authentication shell; the schema and every data request stay protected."""

from __future__ import annotations

import secrets
from importlib.resources import files

from starlette.responses import HTMLResponse


def swagger_page() -> HTMLResponse:
    nonce = secrets.token_urlsafe(32)
    html = files(__package__).joinpath("swagger.html").read_text().replace("__NONCE__", nonce)
    return HTMLResponse(
        html,
        headers={
            "Content-Security-Policy": (
                "default-src 'none'; "
                f"script-src 'nonce-{nonce}' "
                "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0/swagger-ui-bundle.js; "
                "style-src 'unsafe-inline' "
                "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0/swagger-ui.css; "
                "connect-src 'self'; img-src 'self' data:; font-src 'self'; "
                "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
            ),
            "Referrer-Policy": "no-referrer",
            "X-Frame-Options": "DENY",
        },
    )
