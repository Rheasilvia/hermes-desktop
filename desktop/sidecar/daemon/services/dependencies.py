"""FastAPI Depends() callables — singleton services cached on request.app.state.

Usage in routers:
    svc: SessionService = Depends(get_session_service)
"""

from __future__ import annotations

from fastapi import Request

from .agent_pool import AgentPool
from .desktop_meta_service import DesktopMetaService
from .profile_service import ProfileService
from .session_service import SessionService
from .session_state_service import SessionStateService
from .ui_message_service import UIMessageService


def _home_key(home) -> str:
    try:
        return str(home.resolve())
    except Exception:
        return str(home)


def get_profile_service(request: Request) -> ProfileService:
    if not hasattr(request.app.state, "profile_svc"):
        request.app.state.profile_svc = ProfileService(
            request.app.state.cfg.hermes_home
        )
    return request.app.state.profile_svc


def get_active_hermes_home(request: Request):
    return get_profile_service(request).get_active_hermes_home()


def get_session_db(request: Request):
    home = get_active_hermes_home(request)
    key = _home_key(home)
    cache = getattr(request.app.state, "profile_session_dbs", None)
    if cache is None:
        cache = {}
        request.app.state.profile_session_dbs = cache

    if key not in cache:
        from hermes_state import SessionDB
        if key == _home_key(request.app.state.cfg.hermes_home) and hasattr(request.app.state, "session_db"):
            cache[key] = request.app.state.session_db
        else:
            cache[key] = SessionDB(home / "state.db")
    if key == _home_key(request.app.state.cfg.hermes_home):
        request.app.state.session_db = cache[key]
    return cache[key]


def get_agent_pool(request: Request) -> AgentPool:
    home = get_active_hermes_home(request)
    key = _home_key(home)
    cache = getattr(request.app.state, "profile_agent_pools", None)
    if cache is None:
        cache = {}
        request.app.state.profile_agent_pools = cache

    if key not in cache:
        if key == _home_key(request.app.state.cfg.hermes_home) and hasattr(request.app.state, "agent_pool"):
            cache[key] = request.app.state.agent_pool
        else:
            cache[key] = AgentPool(
                hermes_home=home,
                event_bus=request.app.state.event_bus,
                session_db=get_session_db(request),
            )
    if key == _home_key(request.app.state.cfg.hermes_home):
        request.app.state.agent_pool = cache[key]
    return cache[key]


def _cached_service(request: Request, attr: str, factory):
    home = get_active_hermes_home(request)
    key = _home_key(home)
    cache = getattr(request.app.state, attr, None)
    if cache is None:
        cache = {}
        setattr(request.app.state, attr, cache)
    if key not in cache:
        cache[key] = factory(home)
    return cache[key]


def get_event_bus(request: Request):
    return request.app.state.event_bus


def get_session_state_service(request: Request) -> SessionStateService:
    return _cached_service(
        request,
        "profile_session_state_svcs",
        lambda _home: SessionStateService(get_session_db(request)),
    )


def get_desktop_meta_service(request: Request) -> DesktopMetaService:
    return _cached_service(
        request,
        "profile_desktop_meta_svcs",
        lambda home: DesktopMetaService(home),
    )


def get_ui_message_service(request: Request) -> UIMessageService:
    return _cached_service(
        request,
        "profile_ui_message_svcs",
        lambda home: UIMessageService(home),
    )


def get_session_service(request: Request) -> SessionService:
    return _cached_service(
        request,
        "profile_session_svcs",
        lambda home: SessionService(
            hermes_home=home,
            state=get_session_state_service(request),
            meta=get_desktop_meta_service(request),
        ),
    )


def get_title_service(request: Request):
    return _cached_service(
        request,
        "profile_title_svcs",
        lambda _home: __import__(
            "daemon.services.title_service",
            fromlist=["TitleService"],
        ).TitleService(
            state=get_session_state_service(request),
            event_bus=request.app.state.event_bus,
            agent_pool=get_agent_pool(request),
        ),
    )


def get_agent_execution_service(request: Request):
    return _cached_service(
        request,
        "profile_agent_exec_svcs",
        lambda home: __import__(
            "daemon.services.agent_execution_service",
            fromlist=["AgentExecutionService"],
        ).AgentExecutionService(
            hermes_home=home,
            state=get_session_state_service(request),
            ui_messages=get_ui_message_service(request),
            event_bus=get_event_bus(request),
            agent_pool=get_agent_pool(request),
            session_service=get_session_service(request),
        ),
    )


def get_model_service(request: Request):
    home = get_active_hermes_home(request)
    key = _home_key(home)
    default_key = _home_key(request.app.state.cfg.hermes_home)
    cache = getattr(request.app.state, "profile_model_svcs", None)
    if cache is None:
        cache = {}
        request.app.state.profile_model_svcs = cache
    if key not in cache:
        if key == default_key and hasattr(request.app.state, "model_svc"):
            cache[key] = request.app.state.model_svc
        else:
            cache[key] = __import__(
                "daemon.services.model_service",
                fromlist=["ModelService"],
            ).ModelService(
                home,
                event_bus=request.app.state.event_bus,
            )
    if key == default_key:
        request.app.state.model_svc = cache[key]
    return cache[key]


def get_command_service(request: Request):
    return _cached_service(
        request,
        "profile_command_svcs",
        lambda home: __import__(
            "daemon.services.command_service",
            fromlist=["CommandService"],
        ).CommandService(
            hermes_home=home,
            session_service=get_session_service(request),
            agent_pool=get_agent_pool(request),
        ),
    )


def get_workspace_service(request: Request):
    return _cached_service(
        request,
        "profile_workspace_svcs",
        lambda _home: __import__(
            "daemon.services.workspace_service",
            fromlist=["WorkspaceService"],
        ).WorkspaceService(
            session_service=get_session_service(request),
        ),
    )


def get_git_service(request: Request):
    return _cached_service(
        request,
        "profile_git_svcs",
        lambda home: __import__(
            "daemon.services.git_service",
            fromlist=["GitService"],
        ).GitService(
            session_service=get_session_service(request),
            hermes_home=home,
        ),
    )
