from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from retail_data_platform.analytics import analytics_status
from retail_data_platform.api.auth import Principal, TokenVerifier
from retail_data_platform.api.config import Settings
from retail_data_platform.api.database import create_read_engine, read_connection, validate_database
from retail_data_platform.api.limits import ReadBudget
from retail_data_platform.api.query import Query, cursor_for, statement_for
from retail_data_platform.api.resources import RESOURCES, Resource
from retail_data_platform.api.swagger import swagger_page

logger = logging.getLogger("retail_api")
bearer = HTTPBearer(auto_error=False)


def authenticate(
    request: Request,
    credential: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Principal:
    if credential is None:
        raise HTTPException(401, "authentication_required", headers={"WWW-Authenticate": "Bearer"})
    principal: Principal = request.app.state.verifier.verify(credential.credentials)
    request.app.state.budget.consume(principal.subject)
    return principal


Reader = Annotated[Principal, Depends(authenticate)]


def endpoint_for(resource: Resource) -> Callable[..., Response]:
    def read(request: Request, principal: Reader, query: Annotated[Query, Depends()]) -> Response:
        if resource.operations and "operations:read" not in principal.scopes:
            raise HTTPException(403, "insufficient_scope")
        params = request.query_params
        if set(params) - Query.model_fields.keys() or any(
            len(params.getlist(key)) > 1 for key in params
        ):
            raise HTTPException(422, "invalid_query")
        statement = statement_for(resource, query)
        with read_connection(request.app.state.engine) as connection:
            rows = [dict(row) for row in connection.execute(statement).mappings()]
        more = len(rows) > query.limit
        rows = rows[: query.limit]
        page = resource.page_model.model_validate(
            {
                "items": rows,
                "next_cursor": cursor_for(resource, query, rows[-1]) if more else None,
            }
        )
        encoded = page.model_dump_json().encode()
        if len(encoded) > request.app.state.settings.response_bytes:
            raise HTTPException(413, "response_too_large_reduce_limit")
        return Response(encoded, media_type="application/json")

    return read


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings or Settings.from_env()
    engine = create_read_engine(config)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        try:
            try:
                await run_in_threadpool(validate_database, engine, config.schema)
            except Exception:
                raise RuntimeError("API database startup validation failed") from None
            yield
        finally:
            await run_in_threadpool(engine.dispose)

    app = FastAPI(
        title="Retail read API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.engine = engine
    app.state.settings = config
    app.state.verifier = TokenVerifier(config)
    app.state.budget = ReadBudget()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.origins),
        allow_methods=["GET"],
        allow_headers=["Authorization"],
        expose_headers=["X-Request-ID"],
        allow_credentials=False,
    )
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=list(config.hosts))

    @app.middleware("http")
    async def boundary(request: Request, call_next: Callable[..., Any]) -> Response:
        request_id = str(uuid.uuid4())
        start = time.monotonic()
        try:
            if len(request.scope.get("query_string", b"")) > 10_000:
                response: Response = JSONResponse({"error": "query_too_large"}, status_code=414)
            elif request.method not in {"GET", "OPTIONS"}:
                response = JSONResponse(
                    {"error": "method_not_allowed"},
                    status_code=405,
                    headers={"Allow": "GET, OPTIONS"},
                )
            else:
                response = await call_next(request)
        except Exception:
            # Deliberately omit traceback and exception strings: database errors may contain data.
            response = JSONResponse({"error": "internal_error"}, status_code=500)
        response.headers.update(
            {
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "X-Request-ID": request_id,
            }
        )
        logger.info(
            "request_id=%s status=%s duration_ms=%d",
            request_id,
            response.status_code,
            int((time.monotonic() - start) * 1000),
        )
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse({"error": exc.detail}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def validation_error(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"error": "invalid_request"}, status_code=422)

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(
            {"error": "database_unavailable"}, status_code=503, headers={"Retry-After": "5"}
        )

    @app.get("/health/live", include_in_schema=False)
    def live() -> dict[str, str]:
        return {"status": "ok"}

    app.add_api_route("/docs", swagger_page, methods=["GET"], include_in_schema=False)

    @app.get("/v1/openapi.json", include_in_schema=False)
    def schema(principal: Reader) -> dict[str, Any]:
        return app.openapi()

    @app.get("/v1/resources")
    def catalog(principal: Reader) -> list[dict[str, Any]]:
        return [
            {
                "name": r.name,
                "columns": list(r.columns),
                "keys": list(r.keys),
                "filters": list(r.filters),
                "path": f"/v1/data/{r.name}",
            }
            for r in RESOURCES.values()
            if not r.operations or "operations:read" in principal.scopes
        ]

    @app.get("/v1/analytics/status")
    def freshness(principal: Reader) -> dict[str, str | None]:
        return analytics_status(engine)

    for resource in RESOURCES.values():
        app.add_api_route(
            f"/v1/data/{resource.name}",
            endpoint_for(resource),
            methods=["GET"],
            response_model=resource.page_model,
            name="read_" + resource.name,
            description=(
                "Requires data:read"
                + (
                    " and operations:read."
                    if resource.operations
                    else ". Global authorized read access."
                )
            ),
        )
    return app


def main() -> None:
    import uvicorn

    uvicorn.run(
        "retail_data_platform.api.app:create_app",
        factory=True,
        host="127.0.0.1",
        port=8000,
        access_log=False,
        proxy_headers=False,
        limit_concurrency=50,
        timeout_keep_alive=5,
    )


if __name__ == "__main__":
    main()
