"""Conversation endpoints — sessions, prompt/execute, approval, clarify.

Mount point: /desktop/api (configured in app.py).

Endpoints:
  POST   /sessions                      create a new session
  GET    /sessions                      list sessions
  GET    /sessions/{sid}                session detail
  PATCH  /sessions/{sid}                rename session
  DELETE /sessions/{sid}                delete session
  GET    /sessions/{sid}/messages       ui_messages replay (with ?since=)
  POST   /prompt/execute                run an agent turn
  POST   /sessions/{sid}/interrupt      interrupt a running agent
  POST   /approval/respond              answer an approval request
  POST   /clarify/respond               answer a clarification request
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

log = logging.getLogger(__name__)

router = APIRouter()

# ── Request / Response models ─────────────────────────────────────────────────


class CreateSessionRequest(BaseModel):
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    workspace_path: Optional[str] = None


class RenameSessionRequest(BaseModel):
    title: str


class PromptExecuteRequest(BaseModel):
    message: str
    session_id: str


class ApprovalRespondRequest(BaseModel):
    session_id: str
    command: str = ""
    choice: str = "once"  # "once" | "session" | "always" | "deny"


class ClarifyRespondRequest(BaseModel):
    session_id: str
    request_id: str
    answer: str


# ── Helpers ───────────────────────────────────────────────────────────────────


def _get_session_db(request: Request):
    """Lazily open the hermes SessionDB (state.db)."""
    if not hasattr(request.app.state, "session_db"):
        from hermes_state import SessionDB

        cfg = request.app.state.cfg
        request.app.state.session_db = SessionDB(cfg.hermes_home / "state.db")
    return request.app.state.session_db


def _get_agent_pool(request: Request):
    """Lazily create the AgentPool singleton."""
    if not hasattr(request.app.state, "agent_pool"):
        from ..services.agent_pool import AgentPool

        session_db = _get_session_db(request)
        request.app.state.agent_pool = AgentPool(
            hermes_home=request.app.state.cfg.hermes_home,
            event_bus=request.app.state.event_bus,
            session_db=session_db,
        )
    return request.app.state.agent_pool


def _resolve_default_model(body_model: str | None, request: Request) -> tuple[str | None, str | None]:
    """Resolve the default model for a new session.

    Priority:
      1. body.model if provided
      2. model from the most recent desktop session with a non-null model
      3. model from ~/.hermes/config.yaml (read_active_model)

    Returns (model, provider) or (None, None) if no model can be resolved.
    """
    if body_model:
        return body_model, None

    db = _get_session_db(request)
    try:
        rows = db.list_sessions_rich(
            source="desktop",
            include_children=False,
            order_by_last_active=True,
            limit=20,
        )
        for r in rows:
            m = r.get("model")
            if m:
                return m, None
    except Exception:
        log.exception("failed to query recent sessions for model fallback")

    home = request.app.state.cfg.hermes_home
    try:
        from ..readers.hermes_config import read_active_model

        active = read_active_model(home)
        m = active.get("model")
        if m:
            return m, active.get("provider")
    except Exception:
        log.exception("failed to read active model from config")

    return None, None


# ── Session CRUD ──────────────────────────────────────────────────────────────


@router.post("/sessions")
async def create_session(body: CreateSessionRequest, request: Request):
    """Create a new hermes session row. Returns { session_id, ... }."""
    db = _get_session_db(request)
    sid = f"desktop_{uuid.uuid4().hex[:16]}"

    resolved_model, resolved_provider = _resolve_default_model(body.model, request)
    if not resolved_model:
        raise HTTPException(status_code=400, detail="NO_MODEL_CONFIGURED")

    kwargs = {"model": resolved_model}
    if body.system_prompt:
        kwargs["system_prompt"] = body.system_prompt

    db.create_session(sid, "desktop", **kwargs)

    # Also create the desktop_meta row for workspace_path persistence
    from ..db.connection import connect as desktop_connect, ensure_schema

    conn = desktop_connect(request.app.state.cfg.hermes_home)
    ensure_schema(conn)
    now = time.time()
    conn.execute(
        """
        INSERT INTO session_desktop_meta
            (session_id, workspace_path, pinned, archived, last_opened_at, created_at)
        VALUES (?, ?, 0, 0, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            workspace_path = excluded.workspace_path,
            last_opened_at = excluded.last_opened_at
        """,
        (sid, body.workspace_path, now, now),
    )
    conn.commit()
    conn.close()

    # Return session info
    info = db.get_session(sid) or {}
    return {
        "session_id": sid,
        "id": sid,
        "source": "desktop",
        "model": info.get("model", resolved_model),
        "provider": resolved_provider or "",
        "title": info.get("title", "New Session"),
        "started_at": info.get("started_at"),
        "workspace_path": body.workspace_path,
    }


@router.get("/sessions")
async def list_sessions(request: Request):
    """List desktop sessions with rich metadata."""
    db = _get_session_db(request)
    rows = db.list_sessions_rich(
        source="desktop",
        include_children=False,
        order_by_last_active=True,
        limit=50,
    )
    return [
        {
            "id": r["id"],
            "source": r.get("source", "desktop"),
            "model": r.get("model", ""),
            "title": r.get("title", "Untitled"),
            "started_at": r.get("started_at"),
            "message_count": r.get("message_count", 0),
            "last_active": r.get("last_active"),
            "workspace_path": r.get("workspace_path"),
        }
        for r in rows
    ]


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, request: Request):
    """Get a single session's detail."""
    db = _get_session_db(request)
    row = db.get_session(session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")
    return {
        "id": row.get("id", session_id),
        "source": row.get("source", "desktop"),
        "model": row.get("model", ""),
        "title": row.get("title", "Untitled"),
        "started_at": row.get("started_at"),
        "ended_at": row.get("ended_at"),
        "message_count": row.get("message_count", 0),
        "workspace_path": row.get("workspace_path"),
    }


@router.patch("/sessions/{session_id}")
async def rename_session(session_id: str, body: RenameSessionRequest, request: Request):
    """Rename a session."""
    db = _get_session_db(request)
    row = db.get_session(session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    def _do(conn):
        conn.execute(
            "UPDATE sessions SET title = ? WHERE id = ?",
            (body.title, session_id),
        )

    db._execute_write(_do)
    return {"ok": True}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    """Delete a session."""
    db = _get_session_db(request)
    pool = _get_agent_pool(request)
    row = db.get_session(session_id)
    if row is None:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    db.delete_session(session_id)
    pool.evict(session_id)
    return {"ok": True}


# ── Messages replay (ui_messages) ─────────────────────────────────────────────


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    request: Request,
    since: Optional[int] = None,
):
    """Return ui_messages rows, optionally since a given seq.

    Each row is shaped like an SSE event: { session_id, seq, type, payload }.
    """
    from ..db.ui_messages import list_messages

    home = request.app.state.cfg.hermes_home
    rows = list_messages(home, session_id, since_seq=since)
    return [
        {
            "session_id": r["session_id"],
            "seq": r["seq"],
            "type": r["type"],
            "payload": json.loads(r["payload_json"]),
        }
        for r in rows
    ]


# ── Prompt execution ──────────────────────────────────────────────────────────


@router.post("/prompt/execute", status_code=202)
async def prompt_execute(body: PromptExecuteRequest, request: Request):
    """Execute a user prompt against an agent session.

    Runs the agent in a daemon thread.  Returns 202 immediately.
    Events are streamed via SSE as ui_messages rows are appended.
    """
    pool = _get_agent_pool(request)
    db = _get_session_db(request)
    home = request.app.state.cfg.hermes_home
    bus = request.app.state.event_bus
    sid = body.session_id

    # Verify session exists
    if db.get_session(sid) is None:
        raise HTTPException(status_code=404, detail="SESSION_NOT_FOUND")

    entry = pool.get_or_create(sid)
    if entry.running:
        raise HTTPException(status_code=409, detail="SESSION_BUSY")

    # Write user message ui_messages row
    from ..db.ui_messages import append as append_ui_msg

    user_seq = append_ui_msg(home, sid, "user", {"text": body.message})
    bus.publish(sid, user_seq, "user", {"text": body.message})
    bus.publish(sid, user_seq, "message.start", {"message_id": str(uuid.uuid4())})

    # Mark running
    pool.mark_running(sid)

    def _run_turn():
        try:
            # Load conversation history
            llm_messages = db.get_messages_as_conversation(sid)

            # Normalize before giving to agent
            from ..services.context_normalizer import normalize_messages

            normalized = normalize_messages(llm_messages)

            # Run the agent
            agent = entry.agent

            # Kimi Code (sk-kimi-* keys): api.kimi.com/coding speaks Anthropic
            # Messages, not OpenAI chat completions.  Set api_mode before the
            # agent resolves credentials so it lands on the right transport.
            _agent_provider = getattr(agent, "provider", "")
            if _agent_provider in ("kimi-coding", "kimi-coding-cn"):
                try:
                    from hermes_cli.auth import resolve_api_key_provider_credentials
                    _creds = resolve_api_key_provider_credentials(_agent_provider)
                    _bu = _creds.get("base_url", "")
                    if "api.kimi.com" in _bu and "/coding" in _bu:
                        agent.api_mode = "anthropic_messages"
                except Exception:
                    pass

            result = agent.run_conversation(
                user_message=body.message,
                conversation_history=normalized,
            )

            # On success, emit message.complete
            final_text = ""
            if isinstance(result, dict):
                final_text = result.get("final_response", "")
            elif isinstance(result, str):
                final_text = result

            seq = append_ui_msg(home, sid, "message.complete", {
                "text": final_text,
                "rendered": False,
            })
            bus.publish(sid, seq, "message.complete", {
                "text": final_text,
                "rendered": False,
            })

            # Backfill session model if it was not set
            try:
                session_row = db.get_session(sid)
                if session_row and not session_row.get("model"):
                    agent_model = getattr(agent, "model", "")
                    if agent_model:
                        def _update_model(conn):
                            conn.execute(
                                "UPDATE sessions SET model = ? WHERE id = ?",
                                (agent_model, sid),
                            )
                        db._execute_write(_update_model)
            except Exception:
                log.exception("failed to backfill model for session %s", sid)

        except Exception as exc:
            log.exception("agent turn failed for %s", sid)
            # Write turn_error ui_messages row
            error_msg = str(exc)[:500]
            seq = append_ui_msg(home, sid, "turn_error", {"error": error_msg})
            bus.publish(sid, seq, "error", {"message": error_msg})

        finally:
            pool.mark_idle(sid)

    thread = threading.Thread(target=_run_turn, daemon=True)
    pool.set_thread(sid, thread)
    thread.start()

    return {"status": "accepted", "session_id": sid}


# ── Interrupt ─────────────────────────────────────────────────────────────────


@router.post("/sessions/{session_id}/interrupt")
async def interrupt_session(session_id: str, request: Request):
    """Interrupt a running agent turn."""
    pool = _get_agent_pool(request)
    ok = pool.interrupt(session_id)
    if not ok:
        raise HTTPException(status_code=409, detail="NOT_RUNNING")
    return {"ok": True}


# ── Approval / Clarify respond ────────────────────────────────────────────────


@router.post("/approval/respond")
async def approval_respond(body: ApprovalRespondRequest, request: Request):
    """Respond to a pending approval request.

    The choice is stored on the agent and the pending approval promise is resolved.
    """
    # For now, approval goes through the agent's interrupt/resume mechanism.
    # The desktop frontend uses the same pattern as the TUI: it sends the
    # choice back, and the agent thread picks it up from a queue.
    pool = _get_agent_pool(request)
    entry = pool._agents.get(body.session_id)
    if not entry or not entry.running:
        raise HTTPException(status_code=409, detail="NO_RUNNING_SESSION")
    agent = entry.agent
    if hasattr(agent, "_pending_approval"):
        agent._pending_approval = body.choice
    elif hasattr(agent, "resolve_approval"):
        agent.resolve_approval(body.choice)
    return {"ok": True}


@router.post("/clarify/respond")
async def clarify_respond(body: ClarifyRespondRequest, request: Request):
    """Respond to a pending clarification request."""
    pool = _get_agent_pool(request)
    entry = pool._agents.get(body.session_id)
    if not entry or not entry.running:
        raise HTTPException(status_code=409, detail="NO_RUNNING_SESSION")
    agent = entry.agent
    if hasattr(agent, "_pending_clarify"):
        agent._pending_clarify = body.answer
    elif hasattr(agent, "resolve_clarify"):
        agent.resolve_clarify(body.request_id, body.answer)
    return {"ok": True}
