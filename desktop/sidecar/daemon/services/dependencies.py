"""FastAPI Depends() callables — singleton services cached on request.app.state.

Usage in routers:
    svc: SessionService = Depends(get_session_service)
"""

from __future__ import annotations

from fastapi import Request

from .agent_pool import AgentPool
from .desktop_meta_service import DesktopMetaService
from .session_service import SessionService
from .session_state_service import SessionStateService
from .ui_message_service import UIMessageService


def get_session_db(request: Request):
    if not hasattr(request.app.state, "session_db"):
        from hermes_state import SessionDB
        request.app.state.session_db = SessionDB(
            request.app.state.cfg.hermes_home / "state.db"
        )
    return request.app.state.session_db


def get_agent_pool(request: Request) -> AgentPool:
    if not hasattr(request.app.state, "agent_pool"):
        request.app.state.agent_pool = AgentPool(
            hermes_home=request.app.state.cfg.hermes_home,
            event_bus=request.app.state.event_bus,
            session_db=get_session_db(request),
        )
    return request.app.state.agent_pool


def get_event_bus(request: Request):
    return request.app.state.event_bus


def get_session_state_service(request: Request) -> SessionStateService:
    if not hasattr(request.app.state, "session_state_svc"):
        request.app.state.session_state_svc = SessionStateService(get_session_db(request))
    return request.app.state.session_state_svc


def get_desktop_meta_service(request: Request) -> DesktopMetaService:
    if not hasattr(request.app.state, "desktop_meta_svc"):
        request.app.state.desktop_meta_svc = DesktopMetaService(
            request.app.state.cfg.hermes_home
        )
    return request.app.state.desktop_meta_svc


def get_ui_message_service(request: Request) -> UIMessageService:
    if not hasattr(request.app.state, "ui_message_svc"):
        request.app.state.ui_message_svc = UIMessageService(
            request.app.state.cfg.hermes_home
        )
    return request.app.state.ui_message_svc


def get_session_service(request: Request) -> SessionService:
    if not hasattr(request.app.state, "session_svc"):
        request.app.state.session_svc = SessionService(
            hermes_home=request.app.state.cfg.hermes_home,
            state=get_session_state_service(request),
            meta=get_desktop_meta_service(request),
        )
    return request.app.state.session_svc


def get_title_service(request: Request):
    if not hasattr(request.app.state, "title_svc"):
        from .title_service import TitleService
        request.app.state.title_svc = TitleService(
            state=get_session_state_service(request),
            event_bus=get_event_bus(request),
            agent_pool=get_agent_pool(request),
        )
    return request.app.state.title_svc


def get_agent_execution_service(request: Request):
    if not hasattr(request.app.state, "agent_exec_svc"):
        from .agent_execution_service import AgentExecutionService
        request.app.state.agent_exec_svc = AgentExecutionService(
            hermes_home=request.app.state.cfg.hermes_home,
            state=get_session_state_service(request),
            ui_messages=get_ui_message_service(request),
            event_bus=get_event_bus(request),
            agent_pool=get_agent_pool(request),
            session_service=get_session_service(request),
        )
    return request.app.state.agent_exec_svc


def get_model_service(request: Request):
    if not hasattr(request.app.state, "model_svc"):
        from .model_service import ModelService
        request.app.state.model_svc = ModelService(
            request.app.state.cfg.hermes_home,
            event_bus=request.app.state.event_bus,
        )
    return request.app.state.model_svc


def get_command_service(request: Request):
    if not hasattr(request.app.state, "command_svc"):
        from .command_service import CommandService
        request.app.state.command_svc = CommandService(
            hermes_home=request.app.state.cfg.hermes_home,
            session_service=get_session_service(request),
            agent_pool=get_agent_pool(request),
        )
    return request.app.state.command_svc
