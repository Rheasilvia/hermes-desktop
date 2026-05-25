"""Desktop workspace path approval — independent module for file_tools.

When a file operation targets a path outside the session's workspace,
this module blocks the calling thread and emits an approval request to
the frontend. The user can approve once, for the session, or deny.

This is independent from tools/approval.py (which handles dangerous-command
approvals via gateway notify callbacks). Desktop path approval uses its own
callback registration so it can bridge to the desktop event bus.

Decision values: "once" | "session" | "deny".
No "always" support in v1.
"""
from __future__ import annotations

import contextvars
import logging
import threading
from typing import Callable, Dict, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# Per-thread workspace context — set by AgentExecutionService before each turn.
# Tools read these via get_workspace_root() / get_approval_session_id() instead
# of needing agent/session_id passed through every function signature.
_workspace_root: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "workspace_root", default=None,
)
_approval_session_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "approval_session_id", default=None,
)


def set_workspace_context(workspace_root: Optional[str], session_id: Optional[str]) -> tuple:
    """Set workspace root and session ID for the current thread context.

    Returns tokens for reset_workspace_context().
    """
    return (_workspace_root.set(workspace_root), _approval_session_id.set(session_id))


def reset_workspace_context(tokens: tuple) -> None:
    """Restore prior workspace context."""
    _workspace_root.reset(tokens[0])
    _approval_session_id.reset(tokens[1])


def get_workspace_root() -> Optional[str]:
    """Return the workspace root for the current thread, or None."""
    return _workspace_root.get()


def get_approval_session_id() -> Optional[str]:
    """Return the session ID for path approval in the current thread, or None."""
    return _approval_session_id.get()

# Per-session pending approval (serial — one at a time per session)
_pending: Dict[str, threading.Event] = {}
_decisions: Dict[str, str] = {}

# Session-level approval cache: session_id → {(path, operation)}
_session_approvals: Dict[str, Set[Tuple[str, str]]] = {}

# Callback registry: session_id → callable(payload: dict) -> None
# Registered by the desktop backend when building the agent.
_notify_cbs: Dict[str, Callable[[dict], None]] = {}

# Persistence hooks — registered by the desktop backend to store approval
# state in ui_messages for SSE reconnect recovery and backend restart cleanup.
_persist_request_cb: Optional[Callable[[str, dict], None]] = None  # (session_id, payload)
_persist_resolve_cb: Optional[Callable[[str, str], None]] = None   # (session_id, decision)


def register_persistence_hooks(
    on_request: Callable[[str, dict], None],
    on_resolve: Callable[[str, str], None],
) -> None:
    """Register callbacks to persist approval state to ui_messages."""
    global _persist_request_cb, _persist_resolve_cb
    _persist_request_cb = on_request
    _persist_resolve_cb = on_resolve


def register_path_approval_notify(
    session_id: str,
    cb: Callable[[dict], None],
) -> None:
    """Register a callback to emit approval.request events for a session.

    The callback receives a dict with keys: path, operation, command,
    description, is_path_approval. It should bridge to the event bus.
    """
    _notify_cbs[session_id] = cb


def unregister_path_approval_notify(session_id: str) -> None:
    """Unregister the approval callback for a session."""
    _notify_cbs.pop(session_id, None)


def resolve_path_approval(session_id: str, choice: str) -> None:
    """Resolve a pending path approval for a session.

    Called by the desktop backend when the user responds to the approval card.
    Choice must be one of: "once", "session", "deny".
    """
    _decisions[session_id] = choice
    event = _pending.get(session_id)
    if event:
        event.set()


def clear_session_approvals(session_id: str) -> None:
    """Clear all cached approvals for a session (e.g. on session delete)."""
    _session_approvals.pop(session_id, None)


def request_path_approval(
    path: str,
    operation: str,
    session_id: str,
) -> str:
    """Request approval for a path operation outside the workspace.

    Blocks the calling thread until the user responds. Returns the decision:
    "once" — allow this single operation
    "session" — allow this path+operation for the rest of the session
    "deny" — block the operation

    If no callback is registered (e.g. TUI mode), returns "deny" immediately.
    """
    # Check session-level cache first
    cached = _session_approvals.get(session_id)
    if cached and (path, operation) in cached:
        return "once"

    cb = _notify_cbs.get(session_id)
    if cb is None:
        logger.warning(
            "No path approval callback for session %s, denying %s: %s",
            session_id, operation, path,
        )
        return "deny"

    event = threading.Event()
    _pending[session_id] = event

    payload = {
        "path": path,
        "operation": operation,
        "command": f"{operation}: {path}",
        "description": "Outside workspace boundary",
        "is_path_approval": True,
    }

    # Persist pending state for SSE reconnect recovery
    if _persist_request_cb:
        try:
            _persist_request_cb(session_id, payload)
        except Exception:
            logger.exception("Failed to persist approval request for %s", session_id)

    try:
        cb(payload)
    except Exception:
        logger.exception("Path approval callback failed for %s", session_id)
        _pending.pop(session_id, None)
        return "deny"

    # Block until user responds (no timeout — desktop user is present)
    event.wait()

    decision = _decisions.pop(session_id, "deny")
    _pending.pop(session_id, None)

    # Persist resolution
    if _persist_resolve_cb:
        try:
            _persist_resolve_cb(session_id, decision)
        except Exception:
            logger.exception("Failed to persist approval resolution for %s", session_id)

    if decision == "session":
        _session_approvals.setdefault(session_id, set()).add((path, operation))
        return "once"  # Treat as allowed for this call

    return decision
