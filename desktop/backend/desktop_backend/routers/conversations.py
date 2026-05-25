"""Conversation endpoints — sessions, prompt/execute, approval, clarify.

Mount point: /desktop/api (configured in app.py).

All business logic is delegated to service classes injected via FastAPI Depends().
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from ..schemas.conversation import (
    ApprovalRespondRequest,
    ClarifyRespondRequest,
    CreateSessionRequest,
    PromptExecuteRequest,
    UpdateSessionRequest,
    SetSessionProviderRequest,
)
from ..services.dependencies import (
    get_agent_execution_service,
    get_agent_pool,
    get_session_service,
    get_title_service,
    get_ui_message_service,
)
from ..services.exceptions import SessionNotFoundError

router = APIRouter()


# ── Session CRUD ──────────────────────────────────────────────────────────────


@router.post("/sessions")
async def create_session(
    body: CreateSessionRequest,
    svc=Depends(get_session_service),
):
    return svc.create_session(
        workspace_path=body.workspace_path,
        system_prompt=body.system_prompt,
        model=body.model,
        provider=body.provider,
    )


@router.get("/sessions")
async def list_sessions(svc=Depends(get_session_service)):
    return svc.list_sessions()


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, svc=Depends(get_session_service)):
    result = svc.get_session(session_id)
    if result is None:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    return result


@router.patch("/sessions/{session_id}")
async def update_session(
    session_id: str,
    body: UpdateSessionRequest,
    svc=Depends(get_session_service),
):
    try:
        if body.title is not None:
            svc.rename_session(session_id, body.title)
        if body.workspace_path is not None:
            svc.update_workspace(session_id, body.workspace_path)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    return {"ok": True}


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: str,
    svc=Depends(get_session_service),
    pool=Depends(get_agent_pool),
    ui=Depends(get_ui_message_service),
):
    try:
        svc.delete_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    pool.evict(session_id)
    ui.clear_session(session_id)
    return {"ok": True}


@router.put("/sessions/{session_id}/provider")
async def set_session_provider(
    session_id: str,
    body: SetSessionProviderRequest,
    svc=Depends(get_session_service),
    pool=Depends(get_agent_pool),
):
    try:
        result = svc.set_provider(session_id, body.provider, body.model)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    # Check if agent is running — if so, provider change won't apply until next turn
    if pool.is_running(session_id):
        result["applied"] = False
    else:
        pool.evict(session_id)

    return result


# ── Messages replay (ui_messages) ─────────────────────────────────────────────


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    since: Optional[int] = None,
    svc=Depends(get_session_service),
):
    if svc.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    return svc.get_messages(session_id, since_seq=since)


# ── Prompt execution ──────────────────────────────────────────────────────────


@router.post("/prompt/execute", status_code=202)
async def prompt_execute(
    body: PromptExecuteRequest,
    session_svc=Depends(get_session_service),
    pool=Depends(get_agent_pool),
    title_svc=Depends(get_title_service),
    exec_svc=Depends(get_agent_execution_service),
):
    sid = body.session_id

    if session_svc.get_session(sid) is None:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    # Sync provider from frontend, evict agent if changed
    old_provider = session_svc.sync_provider_from_frontend(sid, body.provider)
    if old_provider != body.provider and body.provider:
        pool.evict(sid)

    # Ensure agent exists (lazy build on first prompt)
    entry = pool.get_or_create(sid)
    if entry.running:
        raise HTTPException(status_code=409, detail="SESSION_BUSY")

    # Fire-and-forget title generation (parallel with agent turn)
    title_svc.maybe_generate_title(sid, body.message)

    # Execute agent turn in daemon thread — returns 202 immediately
    exec_svc.execute_turn(sid, body.message)

    return {"status": "accepted", "session_id": sid}


# ── Interrupt ─────────────────────────────────────────────────────────────────


@router.post("/sessions/{session_id}/interrupt")
async def interrupt_session(
    session_id: str,
    pool=Depends(get_agent_pool),
):
    ok = pool.interrupt(session_id)
    if not ok:
        raise HTTPException(status_code=409, detail="NOT_RUNNING")
    return {"ok": True}


# ── Approval / Clarify respond ────────────────────────────────────────────────


@router.post("/approval/respond")
async def approval_respond(
    body: ApprovalRespondRequest,
    pool=Depends(get_agent_pool),
):
    if not pool.is_running(body.session_id):
        raise HTTPException(status_code=409, detail="NO_RUNNING_SESSION")

    # Resolve path approval if pending (desktop workspace restriction)
    from tools.path_approval import resolve_path_approval
    resolve_path_approval(body.session_id, body.choice)

    # Persist resolution to ui_messages for SSE reconnect cleanup
    try:
        from ..db.connection import connect as desktop_connect, ensure_schema
        hermes_home = pool._hermes_home
        conn = desktop_connect(hermes_home)
        ensure_schema(conn)
        conn.execute(
            "UPDATE ui_messages SET payload_json = json_set(payload_json, '$.status', 'resolved') "
            "WHERE session_id = ? AND type = 'pending_approval' "
            "AND json_extract(payload_json, '$.status') = 'pending'",
            (body.session_id,),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass

    # Also resolve legacy agent-level approval
    agent = pool.get_agent_for_session(body.session_id)
    if hasattr(agent, "_pending_approval"):
        agent._pending_approval = body.choice
    elif hasattr(agent, "resolve_approval"):
        agent.resolve_approval(body.choice)
    return {"ok": True}


@router.post("/clarify/respond")
async def clarify_respond(
    body: ClarifyRespondRequest,
    pool=Depends(get_agent_pool),
):
    if not pool.is_running(body.session_id):
        raise HTTPException(status_code=409, detail="NO_RUNNING_SESSION")
    agent = pool.get_agent_for_session(body.session_id)
    if hasattr(agent, "_pending_clarify"):
        agent._pending_clarify = body.answer
    elif hasattr(agent, "resolve_clarify"):
        agent.resolve_clarify(body.request_id, body.answer)
    return {"ok": True}
