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
from .services.event_bus import EventBus
from .services.exceptions import ServiceError

log = logging.getLogger(__name__)

API_PREFIX = "/desktop/api"
PUBLIC_PATHS = {f"{API_PREFIX}/health"}

_SERVICE_ERROR_STATUS = {
    "SESSION_NOT_FOUND": 404,
    "SESSION_BUSY": 409,
    "NO_RUNNING_SESSION": 409,
    "PROVIDER_NOT_FOUND": 404,
    "SCHEMA_VERSION_MISMATCH": 409,
    "MEMORY_FILE_NOT_FOUND": 404,
    "MEMORY_FILE_TOO_LARGE": 413,
    "MEMORY_PATH_INVALID": 400,
    "MEMORY_ENCODING_INVALID": 415,
    "MEMORY_CONCURRENT_WRITE": 409,
}


def build_app(cfg: Config) -> FastAPI:
    from .services.session_service import ensure_default_workspace

    ensure_default_workspace()

    app = FastAPI(title="Hermes Desktop Sidecar", openapi_url=None)

    # Initialize event bus on app state — used by SSE stream and
    # the agent pool to fan out ui_messages events to all connected windows.
    app.state.event_bus = EventBus()

    app.state.cfg = cfg

    app.add_middleware(
        CORSMiddleware,
        # http(s)://localhost|127.0.0.1 → dev (vite devUrl http://localhost:1420)
        # tauri://localhost            → macOS/Linux production webview
        # https://tauri.localhost      → Windows production webview
        allow_origin_regex=(
            r"(https?://(localhost|127\.0\.0\.1)(:\d+)?"
            r"|tauri://localhost"
            r"|https://tauri\.localhost)"
        ),
        allow_credentials=False,
        allow_methods=["GET", "PATCH", "PUT", "POST", "DELETE"],
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
        if cfg.token is None:
            return  # dev mode: no token configured, skip auth
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="AUTH_FAILED")
        provided = header[len("Bearer ") :].strip()
        if not hmac.compare_digest(provided, cfg.token):
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

    @app.exception_handler(ServiceError)
    async def service_error_handler(request: Request, exc: ServiceError):
        # Memory concurrent-write conflicts return a richer body so the UI
        # can show a merge dialog without a follow-up GET.
        from .services.exceptions import MemoryConcurrentWriteError
        if isinstance(exc, MemoryConcurrentWriteError) and exc.current is not None:
            body = {
                "code": exc.code,
                "detail": exc.detail,
                "trace_id": getattr(request.state, "trace_id", "unknown"),
                "current": exc.current,
            }
            return JSONResponse(body, status_code=409)

        status = _SERVICE_ERROR_STATUS.get(exc.code, 500)
        env = ErrorEnvelope(
            code=exc.code,
            detail=exc.detail,
            trace_id=getattr(request.state, "trace_id", "unknown"),
        )
        return JSONResponse(env.model_dump(exclude_none=True), status_code=status)

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
        oauth,
        model,
        settings as settings_router,
        state as state_router,
        overlays,
        analytics,
        skills,
        plugins as plugins_router,
        conversations as conversations_router,
        commands as commands_router,
        events as events_router,
        memory as memory_router,
    )

    app.include_router(health.router, prefix=API_PREFIX)
    deps = [Depends(require_token)]
    app.include_router(cron.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(oauth.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(model.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(settings_router.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(state_router.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(overlays.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(analytics.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(skills.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(plugins_router.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(conversations_router.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(commands_router.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(memory_router.router, prefix=API_PREFIX, dependencies=deps)
    # SSE stream — auth handled via query param token (browsers can't set Authorization on EventSource)
    app.include_router(events_router.router, prefix=API_PREFIX)

    # ── Startup: sync overlay API keys → .env so TUI/CLI can see them ──
    @app.on_event("startup")
    def _sync_overlay_keys_to_env():
        _sync_provider_keys(cfg.hermes_home)

    # ── Startup: eagerly init services + pre-warm agent for recent sessions ──
    @app.on_event("startup")
    def _prewarm_agents():
        import threading

        try:
            from hermes_state import SessionDB
            from .services.agent_pool import AgentPool

            session_db = SessionDB(cfg.hermes_home / "state.db")
            agent_pool = AgentPool(
                hermes_home=cfg.hermes_home,
                event_bus=app.state.event_bus,
                session_db=session_db,
            )
            app.state.session_db = session_db
            app.state.agent_pool = agent_pool
        except Exception:
            log.exception("[prewarm] failed to initialize services")
            return

        def _do_prewarm():
            try:
                sessions = session_db.list_sessions_rich(
                    source="desktop",
                    include_children=False,
                    order_by_last_active=True,
                    limit=3,
                )
                for sess in sessions[:3]:
                    sid = str(sess.get("id") or sess.get("session_id") or "")
                    if sid:
                        agent_pool.get_or_create(sid)
                        log.info("[prewarm] agent ready for session %s", sid)
            except Exception:
                log.exception("[prewarm] background thread failed")

        threading.Thread(target=_do_prewarm, daemon=True, name="agent-prewarm").start()

    return app


def _sync_provider_keys(hermes_home: Path) -> None:
    """Copy every API key from desktop overlays into ~/.hermes/.env.

    Ensures TUI/CLI (which reads .env, not overlays) sees keys stored via
    the desktop model config page.
    """
    import os
    from pathlib import Path

    try:
        from .overlays import loader as overlays_loader
        overlay = overlays_loader.load(hermes_home, "model")
    except Exception:
        return

    try:
        from hermes_cli.auth import PROVIDER_REGISTRY
        from hermes_cli.config import save_env_value, get_env_value
    except Exception:
        return

    # Provider siblings that share the same key
    _SIBLING_PROVIDERS = (
        ("kimi-coding", "kimi-coding-cn"),
    )

    for provider_id, entry in overlay.items():
        api_key = str(entry.get("api_key") or "").strip()
        if not api_key:
            continue

        # Collect all providers that should get this key (self + siblings)
        ids_to_sync = {provider_id}
        for group in _SIBLING_PROVIDERS:
            if provider_id in group:
                ids_to_sync.update(group)

        for pid in ids_to_sync:
            pconfig = PROVIDER_REGISTRY.get(pid)
            if not pconfig or not pconfig.api_key_env_vars:
                continue
            for env_var in pconfig.api_key_env_vars:
                existing = (get_env_value(env_var) or "").strip()
                if existing != api_key:
                    try:
                        os.environ["HERMES_HOME"] = str(hermes_home)
                        save_env_value(env_var, api_key)
                        log.info("Synced %s key to .env as %s", provider_id, env_var)
                    except Exception:
                        log.warning("Failed to sync %s to .env", provider_id)


def _domain_from_path(path: str) -> Optional[str]:
    parts = path.strip("/").split("/")
    if len(parts) >= 3 and parts[0] == "desktop" and parts[1] == "api":
        return parts[2]
    return None
