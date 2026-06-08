"""Desktop workspace path approval — independent module for file_tools.

When a file operation targets a path outside the session's workspace,
this module blocks the calling thread and emits an approval request to
the frontend. The user can approve once, for the session, or deny.

Concurrency model
-----------------
Each session has a dedicated queue and a daemon pump thread.  All approval
requests for a session are enqueued as (event, path, operation, session_key,
payload) tuples.  The pump dequeues one item at a time, shows it to the user
(via the notify callback), and waits for resolve_path_approval() to unblock
the event.  This ensures the frontend never sees two overlapping approval
cards for the same session.

Session-level approval keys
----------------------------
The ``session_key`` argument encodes approval granularity, analogous to
Claude Code's PermissionRule ruleContent:

  "read:/some/dir"          → prefix match: approves all reads under /some/dir
  "write:/exact/file.py"    → exact match: only this one file
  "search:/some/dir"        → prefix match: approves searches under /some/dir
  "terminal:ls"             → prefix match: all ls commands this session
  "terminal:rm:/exact/path" → exact match: only this rm invocation

Matching uses _key_matches(approved_key, request_key):
  exact  → approved_key == request_key
  prefix → request_key.startswith(approved_key + "/")  (path segments)
         or request_key.startswith(approved_key + ":")  (colon-delimited)

Decision values: "once" | "session" | "deny".
"""
from __future__ import annotations

import contextvars
import hashlib
import logging
import os
import queue
import threading
from pathlib import Path
from typing import Callable, Dict, Optional, Set

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Per-thread workspace context
# ---------------------------------------------------------------------------

_workspace_root: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "workspace_root", default=None,
)
_approval_session_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "approval_session_id", default=None,
)
_approval_turn_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "approval_turn_id", default=None,
)
_permission_mode: contextvars.ContextVar[str] = contextvars.ContextVar(
    "permission_mode", default="auto",
)


def set_workspace_context(
    workspace_root: Optional[str],
    session_id: Optional[str],
    turn_id: Optional[str] = None,
    permission_mode: str = "auto",
) -> tuple:
    """Set workspace root and session ID for the current thread context.

    Returns tokens for reset_workspace_context().
    """
    return (
        _workspace_root.set(workspace_root),
        _approval_session_id.set(session_id),
        _approval_turn_id.set(turn_id),
        _permission_mode.set(_normalize_permission_mode(permission_mode)),
    )


def reset_workspace_context(tokens: tuple) -> None:
    """Restore prior workspace context."""
    _workspace_root.reset(tokens[0])
    _approval_session_id.reset(tokens[1])
    if len(tokens) > 2:
        _approval_turn_id.reset(tokens[2])
    if len(tokens) > 3:
        _permission_mode.reset(tokens[3])


def get_workspace_root() -> Optional[str]:
    """Return the workspace root for the current thread, or None."""
    return _workspace_root.get()


def get_approval_session_id() -> Optional[str]:
    """Return the session ID for path approval in the current thread, or None."""
    return _approval_session_id.get()


def get_approval_turn_id() -> Optional[str]:
    """Return the current desktop turn ID for path approval, or None."""
    return _approval_turn_id.get()


def _normalize_permission_mode(mode: str | None) -> str:
    value = str(mode or "").strip().lower()
    return value if value in {"ask", "auto", "full"} else "auto"


def get_permission_mode() -> str:
    """Return the desktop file permission mode for the current turn context."""
    return _normalize_permission_mode(_permission_mode.get())


# ---------------------------------------------------------------------------
# Module-level state
# ---------------------------------------------------------------------------

# session_id → Queue of (event, path, operation, session_key, payload)
_approval_queues: Dict[str, queue.Queue] = {}
_queue_lock = threading.Lock()  # guards creation of new queues/pumps

# session_id → currently-active event (the one the pump is waiting on)
_active: Dict[str, Optional[threading.Event]] = {}

# session_id → pump daemon thread
_pumps: Dict[str, threading.Thread] = {}

# session_id → set of approved session_keys (in-memory cache)
_session_approvals: Dict[str, Set[str]] = {}

# Callback registry: session_id → callable(payload: dict) -> None
_notify_cbs: Dict[str, Callable[[dict], None]] = {}

# Persistence hooks
_persist_request_cb: Optional[Callable[[str, dict], None]] = None
_persist_resolve_cb: Optional[Callable[[str, str], None]] = None

# hermes_home provider — set by desktop backend
_hermes_home_cb: Optional[Callable[[], Path]] = None


# ---------------------------------------------------------------------------
# Registration helpers
# ---------------------------------------------------------------------------

def register_persistence_hooks(
    on_request: Callable[[str, dict], None],
    on_resolve: Callable[[str, str], None],
) -> None:
    """Register callbacks to persist approval state to ui_messages."""
    global _persist_request_cb, _persist_resolve_cb
    _persist_request_cb = on_request
    _persist_resolve_cb = on_resolve


def register_hermes_home(cb: Callable[[], Path]) -> None:
    """Register a callable that returns the current hermes_home Path."""
    global _hermes_home_cb
    _hermes_home_cb = cb


def register_path_approval_notify(
    session_id: str,
    cb: Callable[[dict], None],
) -> None:
    """Register a callback to emit approval.request events for a session."""
    _notify_cbs[session_id] = cb


def unregister_path_approval_notify(session_id: str) -> None:
    """Unregister the approval callback for a session."""
    _notify_cbs.pop(session_id, None)


# ---------------------------------------------------------------------------
# Key matching
# ---------------------------------------------------------------------------

def _key_matches(approved_key: str, request_key: str) -> bool:
    """Return True if approved_key covers request_key.

    Supports:
      exact  — "write:/foo/bar.py"  matches  "write:/foo/bar.py"
      prefix — "read:/some/dir"     matches  "read:/some/dir/file.py"
               "terminal:ls"        matches  "terminal:ls:/outside/path"
    """
    if approved_key == request_key:
        return True
    # path-segment prefix: "read:/dir" covers "read:/dir/sub/file"
    if request_key.startswith(approved_key + "/"):
        return True
    # colon-delimited prefix: "terminal:ls" covers "terminal:ls:/path"
    if request_key.startswith(approved_key + ":"):
        return True
    return False


def _session_has_approval(session_id: str, session_key: str) -> bool:
    """Check in-memory cache for a matching approval rule."""
    for approved_key in _session_approvals.get(session_id, set()):
        if _key_matches(approved_key, session_key):
            return True
    return False


def _workspace_hash(workspace_root: Optional[str]) -> str:
    raw = workspace_root or "no-workspace"
    try:
        raw = os.path.realpath(os.path.expanduser(raw))
    except Exception:
        raw = str(raw)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _workspace_scoped_key(session_key: str, workspace_root: Optional[str]) -> str:
    if session_key.startswith("ws:"):
        return session_key
    return f"ws:{_workspace_hash(workspace_root)}:{session_key}"


def _path_within_workspace(path: str, workspace_root: Optional[str]) -> bool:
    if not workspace_root:
        return False
    try:
        candidate = Path(path).expanduser().resolve()
        workspace = Path(workspace_root).expanduser().resolve()
        return candidate == workspace or workspace in candidate.parents
    except Exception:
        return False


def _is_write_operation(operation: str) -> bool:
    return operation.strip().lower() in {"write", "edit", "patch"}


def _load_approvals_from_db(session_id: str) -> None:
    """Populate in-memory cache from DB (called once per session on first miss)."""
    if _hermes_home_cb is None:
        return
    try:
        from desktop.sidecar.daemon.db.ui_messages import load_session_approvals
        keys = {
            key for key in load_session_approvals(_hermes_home_cb(), session_id)
            if isinstance(key, str) and key.startswith("ws:")
        }
        if keys:
            _session_approvals.setdefault(session_id, set()).update(keys)
    except Exception:
        logger.exception("Failed to load session approvals from DB for %s", session_id)


# ---------------------------------------------------------------------------
# Pump thread
# ---------------------------------------------------------------------------

# sentinel: pump marks a session as "db-loaded" so we only query once
_db_loaded: set = set()


def _pump(session_id: str) -> None:
    """Daemon thread: serialise approval requests for one session."""
    q = _approval_queues[session_id]
    while True:
        try:
            item = q.get(timeout=120)
        except queue.Empty:
            # No requests for 2 minutes — clean up pump
            with _queue_lock:
                if q.empty():
                    _pumps.pop(session_id, None)
                    _approval_queues.pop(session_id, None)
                    _active.pop(session_id, None)
                    return
            continue

        event, path, operation, session_key, payload = item

        # Re-check cache — a prior "session" decision in this queue run
        # may have already covered this key.
        if _session_has_approval(session_id, session_key):
            event._decision = "once"
            event.set()
            q.task_done()
            continue

        cb = _notify_cbs.get(session_id)
        if cb is None:
            logger.warning(
                "No path approval callback for session %s, denying %s: %s",
                session_id, operation, path,
            )
            event._decision = "deny"
            event.set()
            q.task_done()
            continue

        # Attach context so resolve_path_approval can read it
        event._path = path
        event._operation = operation
        event._session_key = session_key
        _active[session_id] = event

        if _persist_request_cb:
            try:
                _persist_request_cb(session_id, payload)
            except Exception:
                logger.exception("Failed to persist approval request for %s", session_id)

        try:
            cb(payload)
        except Exception:
            logger.exception("Path approval callback failed for %s", session_id)
            event._decision = "deny"
            event.set()
            q.task_done()
            _active.pop(session_id, None)
            continue

        # Block until user responds
        event.wait()
        q.task_done()
        _active.pop(session_id, None)


def _ensure_pump(session_id: str) -> None:
    """Ensure a pump thread is running for session_id."""
    with _queue_lock:
        if session_id not in _approval_queues:
            _approval_queues[session_id] = queue.Queue()
        if session_id not in _pumps or not _pumps[session_id].is_alive():
            t = threading.Thread(
                target=_pump,
                args=(session_id,),
                daemon=True,
                name=f"approval-pump-{session_id[:8]}",
            )
            _pumps[session_id] = t
            t.start()


# ---------------------------------------------------------------------------
# Fast-forward: batch-resolve same-key items in the queue
# ---------------------------------------------------------------------------

def _fast_forward_queue(session_id: str, key: str) -> None:
    """Auto-resolve all queued items whose session_key matches key.

    Called from resolve_path_approval() immediately after a "session" decision
    so that concurrent tool calls waiting in the queue don't need to surface
    individual approval dialogs for the same already-approved key.
    """
    q = _approval_queues.get(session_id)
    if q is None:
        return

    # Drain the queue, resolve matching items, re-enqueue the rest
    items = []
    while True:
        try:
            items.append(q.get_nowait())
            q.task_done()
        except queue.Empty:
            break

    for item in items:
        ev, p, op, sk, payload = item
        if _key_matches(key, sk):
            ev._decision = "once"
            ev.set()
        else:
            q.put(item)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_path_approval(session_id: str, choice: str) -> None:
    """Resolve the currently-active approval for a session.

    Called by the desktop backend when the user responds to the approval card.
    choice must be one of: "once", "session", "deny".
    """
    event = _active.get(session_id)
    if event is None:
        logger.warning("resolve_path_approval: no active approval for session %s", session_id)
        return

    event._decision = choice

    if choice == "session":
        key = event._session_key
        _session_approvals.setdefault(session_id, set()).add(key)

        # Persist to DB
        if _hermes_home_cb is not None:
            try:
                from desktop.sidecar.daemon.db.ui_messages import save_session_approval
                save_session_approval(_hermes_home_cb(), session_id, key)
            except Exception:
                logger.exception("Failed to persist session approval for %s", session_id)

        # Batch-resolve any queued items already covered by this key
        _fast_forward_queue(session_id, key)

    if _persist_resolve_cb:
        try:
            _persist_resolve_cb(session_id, choice)
        except Exception:
            logger.exception("Failed to persist approval resolution for %s", session_id)

    event.set()


def clear_session_approvals(session_id: str) -> None:
    """Clear all cached approvals for a session (e.g. on session delete)."""
    _session_approvals.pop(session_id, None)
    _db_loaded.discard(session_id)

    if _hermes_home_cb is not None:
        try:
            from desktop.sidecar.daemon.db.ui_messages import clear_session_approvals_db
            clear_session_approvals_db(_hermes_home_cb(), session_id)
        except Exception:
            logger.exception("Failed to clear DB approvals for %s", session_id)


def preload_session_approvals(session_id: str) -> None:
    """Load historical session approvals from DB into memory.

    Called by agent_pool when building/resuming an agent so that already-
    approved keys are honoured without prompting the user again.
    """
    if session_id in _db_loaded:
        return
    _db_loaded.add(session_id)
    _load_approvals_from_db(session_id)


def request_path_approval(
    path: str,
    operation: str,
    session_id: str,
    session_key: str,
) -> str:
    """Request approval for a path operation outside the workspace.

    Blocks the calling thread until the user responds.  Returns:
      "once"    — allow this single operation
      "session" — allow via session-level rule (returned as "once" to callers)
      "deny"    — block the operation

    If no notify callback is registered, returns "deny" immediately.
    """
    workspace_root = get_workspace_root()
    mode = get_permission_mode()
    scoped_session_key = _workspace_scoped_key(session_key, workspace_root)

    if mode == "full":
        return "once"

    within_workspace = _path_within_workspace(path, workspace_root)
    if mode == "auto" and within_workspace:
        return "once"
    if mode == "ask" and within_workspace and not _is_write_operation(operation):
        return "once"

    # Lazy-load DB approvals on first request for this session
    if session_id not in _db_loaded:
        _db_loaded.add(session_id)
        _load_approvals_from_db(session_id)

    # Fast path: already approved by a session-level rule
    if _session_has_approval(session_id, scoped_session_key):
        return "once"

    # No callback → TUI mode or unregistered session
    if _notify_cbs.get(session_id) is None:
        logger.warning(
            "No path approval callback for session %s, denying %s: %s",
            session_id, operation, path,
        )
        return "deny"

    payload = {
        "path": path,
        "operation": operation,
        "command": f"{operation}: {path}",
        "description": "Outside workspace boundary",
        "is_path_approval": True,
        "session_key": scoped_session_key,
    }
    turn_id = get_approval_turn_id()
    if turn_id:
        payload["turn_id"] = turn_id

    event = threading.Event()
    event._decision = "deny"  # type: ignore[attr-defined]
    event._path = path         # type: ignore[attr-defined]
    event._operation = operation  # type: ignore[attr-defined]
    event._session_key = session_key  # type: ignore[attr-defined]

    _ensure_pump(session_id)
    _approval_queues[session_id].put((event, path, operation, scoped_session_key, payload))

    # Block until the pump dequeues and resolves this event
    event.wait()

    decision = event._decision  # type: ignore[attr-defined]

    if _persist_resolve_cb:
        try:
            _persist_resolve_cb(session_id, decision)
        except Exception:
            logger.exception("Failed to persist approval resolution for %s", session_id)

    # Both "once" and "session" allow this call
    return "once" if decision == "session" else decision
