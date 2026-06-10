"""Conversation endpoints — sessions, prompt/execute, approval, clarify.

Mount point: /desktop/api (configured in app.py).

All business logic is delegated to service classes injected via FastAPI Depends().
"""

from __future__ import annotations

import logging
from typing import Optional

import hmac

from fastapi import APIRouter, Depends, HTTPException, Request

from ..schemas.conversation import (
    ApprovalRespondRequest,
    ClarifyRespondRequest,
    CreateSessionRequest,
    ImageAttachRequest,
    ImageDetachRequest,
    PromptExecuteRequest,
    SecretRespondRequest,
    SetPermissionModeRequest,
    UpdateSessionRequest,
    SetSessionProviderRequest,
    SudoRespondRequest,
)
from ..services.dependencies import (
    get_agent_execution_service,
    get_agent_pool,
    get_event_bus,
    get_session_service,
    get_title_service,
    get_ui_message_service,
)
from ..services.exceptions import SessionNotFoundError

router = APIRouter()
log = logging.getLogger(__name__)

_WORKSPACE_GRANT_HEADER = "x-desktop-workspace-grant"


def _require_workspace_grant(request: Request) -> None:
    expected = getattr(request.app.state.cfg, "workspace_grant_token", None)
    provided = request.headers.get(_WORKSPACE_GRANT_HEADER, "")
    if not expected or not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(status_code=403, detail="WORKSPACE_GRANT_REQUIRED")


# ── Session CRUD ──────────────────────────────────────────────────────────────


@router.post("/sessions")
async def create_session(
    request: Request,
    body: CreateSessionRequest,
    svc=Depends(get_session_service),
    pool=Depends(get_agent_pool),
):
    if body.cwd is not None:
        _require_workspace_grant(request)
    result = svc.create_session(
        cwd=body.cwd,
        system_prompt=body.system_prompt,
        model=body.model,
        provider=body.provider,
    )
    # Pre-warm the agent in a background thread so the first prompt.execute
    # doesn't hit the full cold-start path (credential resolution, system
    # prompt build, tool loading — all synchronous in get_or_create).
    sid = result.get("session_id") or result.get("id") or ""
    if sid and (body.provider or body.model):
        import threading
        import logging
        _log = logging.getLogger(__name__)

        def _warm():
            try:
                pool.get_or_create(sid)
                _log.info("[prewarm] agent pre-warmed for new session %s", sid)
            except Exception:
                _log.debug("[prewarm] background build for %s failed (non-fatal)", sid, exc_info=True)

        threading.Thread(target=_warm, daemon=True, name=f"prewarm-{sid[:8]}").start()
    return result


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
    request: Request,
    session_id: str,
    body: UpdateSessionRequest,
    svc=Depends(get_session_service),
    pool=Depends(get_agent_pool),
):
    try:
        resolved_cwd = None
        if body.cwd is not None:
            _require_workspace_grant(request)
            svc.get_session_or_404(session_id)
            if pool.is_running(session_id):
                raise HTTPException(status_code=409, detail="SESSION_BUSY")
        if body.title is not None:
            svc.rename_session(session_id, body.title)
        if body.cwd is not None:
            resolved_cwd = svc.update_cwd(session_id, body.cwd)
            pool.evict(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    response = {"ok": True}
    if resolved_cwd is not None:
        response["cwd"] = resolved_cwd
    return response


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


@router.post("/sessions/{session_id}/branch")
async def branch_session(
    session_id: str,
    svc=Depends(get_session_service),
):
    try:
        return svc.branch_session(session_id)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.put("/sessions/{session_id}/permission-mode")
async def set_permission_mode(
    session_id: str,
    body: SetPermissionModeRequest,
    svc=Depends(get_session_service),
    pool=Depends(get_agent_pool),
    ui=Depends(get_ui_message_service),
):
    try:
        running = pool.is_running(session_id)
        result = svc.set_permission_mode(session_id, body.mode)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    result["appliedToActiveTurn"] = not running
    result["appliesNextTurn"] = running
    try:
        ui.append(
            session_id,
            "permission.mode.changed",
            {
                "permissionMode": result["permissionMode"],
                "appliedToActiveTurn": not running,
                "appliesNextTurn": running,
            },
        )
    except Exception:
        log.exception("failed to append permission mode audit event for %s", session_id)
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


@router.get("/sessions/{session_id}/transcript")
async def get_session_transcript(
    session_id: str,
    svc=Depends(get_session_service),
):
    if svc.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    return svc.get_transcript(session_id)


# ── Prompt execution ──────────────────────────────────────────────────────────


@router.post("/prompt/execute", status_code=202)
async def prompt_execute(
    body: PromptExecuteRequest,
    session_svc=Depends(get_session_service),
    pool=Depends(get_agent_pool),
    title_svc=Depends(get_title_service),
    exec_svc=Depends(get_agent_execution_service),
):
    import time, logging
    _log = logging.getLogger(__name__)
    _t0 = time.time()
    sid = body.session_id

    session = session_svc.get_session(sid)
    if session is None:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    cwd = session.get("cwd") or ""

    # Evict stale agent first — compares against built_model/built_provider to handle
    # the case where setSessionProvider already updated the DB before this call.
    pool.evict_if_stale(sid, body.provider, body.model, cwd)

    # Sync provider and model from frontend into DB (for agent rebuild on next get_or_create)
    session_svc.sync_provider_from_frontend(sid, body.provider)
    session_svc.sync_model_from_frontend(sid, body.model)

    # Ensure agent exists (lazy build on first prompt)
    entry = pool.get_or_create(sid)
    if entry.running:
        raise HTTPException(status_code=409, detail="SESSION_BUSY")

    # Fire-and-forget title generation (parallel with agent turn)
    title_svc.maybe_generate_title(sid, body.message)

    # Execute agent turn in daemon thread — returns 202 immediately
    turn = exec_svc.execute_turn(
        sid,
        body.message,
        context=body.context,
        slash_command=body.slash_command,
        display_parts=body.display_parts,
    )

    _log.info("[perf] prompt_execute total: %.2fs (sid=%s provider=%r model=%r)",
              time.time() - _t0, sid, body.provider, body.model)
    return {
        "status": "accepted",
        "session_id": sid,
        "turn_id": turn["turn_id"],
        "user_seq": turn["user_seq"],
    }


@router.post("/image/attach")
async def image_attach(
    body: ImageAttachRequest,
    svc=Depends(get_session_service),
):
    try:
        return svc.attach_image(body.session_id, body.path)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/image/detach")
async def image_detach(
    body: ImageDetachRequest,
    svc=Depends(get_session_service),
):
    try:
        return svc.detach_image(body.session_id, body.path)
    except SessionNotFoundError:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")


# ── Interrupt ─────────────────────────────────────────────────────────────────


@router.post("/sessions/{session_id}/interrupt")
async def interrupt_session(
    session_id: str,
    pool=Depends(get_agent_pool),
    ui=Depends(get_ui_message_service),
    bus=Depends(get_event_bus),
):
    # force_reset interrupts the agent AND frees the session even if its turn
    # thread is wedged (e.g. a stalled provider stream that never returns), so
    # the user can immediately continue the conversation. Idempotent: stopping
    # an already-idle session is a no-op success.
    turn_id = pool.get_active_turn_id(session_id)
    if turn_id:
        payload = {"reason": "user_interrupt", "turn_id": turn_id}
        seq = ui.append(session_id, "turn.interrupted", payload, turn_id=turn_id)
        bus.publish(session_id, seq, "turn.interrupted", payload)
    pool.force_reset(session_id)
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


@router.post("/sudo/respond")
async def sudo_respond(body: SudoRespondRequest):
    from ..services.agent_execution_service import resolve_blocking_prompt

    if not resolve_blocking_prompt(body.request_id, body.password):
        raise HTTPException(status_code=404, detail="NO_PENDING_SUDO_REQUEST")
    return {"ok": True}


@router.post("/secret/respond")
async def secret_respond(body: SecretRespondRequest):
    from ..services.agent_execution_service import resolve_blocking_prompt

    if not resolve_blocking_prompt(body.request_id, body.value):
        raise HTTPException(status_code=404, detail="NO_PENDING_SECRET_REQUEST")
    return {"ok": True}
