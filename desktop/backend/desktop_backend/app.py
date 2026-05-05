"""FastAPI app factory. All routes mounted under /desktop/api."""
from __future__ import annotations

import hmac
import logging
import uuid
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Config
from .readers.cron_reader import L1CorruptError
from .schemas.error import ErrorEnvelope

log = logging.getLogger(__name__)

API_PREFIX = "/desktop/api"
PUBLIC_PATHS = {f"{API_PREFIX}/health"}


def build_app(cfg: Config) -> FastAPI:
    app = FastAPI(title="Hermes Desktop Sidecar", openapi_url=None)
    app.state.cfg = cfg

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["tauri://localhost", "http://localhost:1420"],
        allow_credentials=False,
        allow_methods=["GET", "PATCH", "PUT"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def attach_trace_id(request: Request, call_next):
        request.state.trace_id = uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Trace-Id"] = request.state.trace_id
        return response

    def require_token(request: Request) -> None:
        if request.url.path in PUBLIC_PATHS:
            return
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="AUTH_FAILED")
        provided = header[len("Bearer ") :].strip()
        if cfg.token is None or not hmac.compare_digest(provided, cfg.token):
            raise HTTPException(status_code=401, detail="AUTH_FAILED")

    app.dependency_overrides = {}

    @app.exception_handler(HTTPException)
    async def http_exc_handler(request: Request, exc: HTTPException):
        code = exc.detail if isinstance(exc.detail, str) else "INTERNAL"
        env = ErrorEnvelope(
            code=code,
            trace_id=getattr(request.state, "trace_id", "unknown"),
        )
        return JSONResponse(
            env.model_dump(exclude_none=True), status_code=exc.status_code
        )

    @app.exception_handler(L1CorruptError)
    async def l1_corrupt_handler(request: Request, exc: L1CorruptError):
        env = ErrorEnvelope(
            code="L1_CORRUPT",
            domain=_domain_from_path(request.url.path),
            path=exc.path,
            detail=exc.detail,
            trace_id=getattr(request.state, "trace_id", "unknown"),
        )
        return JSONResponse(env.model_dump(exclude_none=True), status_code=503)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception(
            "unhandled", extra={"trace_id": getattr(request.state, "trace_id", "?")}
        )
        env = ErrorEnvelope(
            code="INTERNAL",
            detail=str(exc),
            trace_id=getattr(request.state, "trace_id", "unknown"),
        )
        return JSONResponse(env.model_dump(exclude_none=True), status_code=500)

    # Register routers
    from .routers import (
        health,
        cron,
        model,
        settings as settings_router,
        state as state_router,
        overlays,
    )

    app.include_router(health.router, prefix=API_PREFIX)
    deps = [Depends(require_token)]
    app.include_router(cron.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(model.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(settings_router.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(state_router.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(overlays.router, prefix=API_PREFIX, dependencies=deps)

    return app


def _domain_from_path(path: str) -> Optional[str]:
    parts = path.strip("/").split("/")
    if len(parts) >= 3 and parts[0] == "desktop" and parts[1] == "api":
        return parts[2]
    return None
