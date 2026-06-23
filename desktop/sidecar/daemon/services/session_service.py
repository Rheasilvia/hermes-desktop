"""SessionService — facade composing SessionStateService + DesktopMetaService.

Routers depend on this single service for all session lifecycle operations.
It orchestrates both data stores (state.db and desktop.db) behind one API.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any

from .exceptions import SessionNotFoundError
from .interfaces import DesktopMetaStore, SessionStateStore
from .path_validation import resolve_existing_cwd, resolve_under_cwd
from .desktop_meta_service import (
    DEFAULT_COLLABORATION_MODE,
    DEFAULT_REASONING_EFFORT,
    normalize_collaboration_mode,
    normalize_permission_mode,
)

log = logging.getLogger(__name__)

DEFAULT_WORKSPACE = Path.home() / "HermesAgentWorkspace"
REUSABLE_EMPTY_TITLES = frozenset(
    {"", "new session", "untitled", "untitled new conversation"}
)
ARCHIVE_FILTERS = frozenset({"exclude", "only", "include"})
SESSION_LIST_FETCH_LIMIT = 200
SESSION_LIST_RETURN_LIMIT = 50


def ensure_default_workspace() -> Path:
    """Return the desktop default workspace, creating it on first use."""
    DEFAULT_WORKSPACE.mkdir(parents=True, exist_ok=True)
    return DEFAULT_WORKSPACE


def _resolve_image_path(path: str, cwd: str) -> Path:
    """Resolve an image attachment path.

    Workspace-sourced images are scoped to the session cwd (the existing
    security boundary). Two app-managed locations are also trusted (with
    path-component comparison, not string prefix, to avoid admitting sibling
    directories whose names merely share a prefix):

    - the system temp dir — clipboard-pasted images land there
    - ``<HERMES_HOME>/sessions/<id>/assets/`` — the durable per-session asset
      dir the Rust layer copies images into so attachments survive a restart
    """
    raw = str(path or "").strip()
    candidate = Path(raw).expanduser()
    if candidate.is_absolute():
        try:
            resolved_abs = candidate.resolve()
        except OSError:
            resolved_abs = candidate
        # Trusted app-managed roots.
        trusted_roots: list[Path] = [Path(tempfile.gettempdir()).resolve()]
        # Resolve HERMES_HOME the same way the Rust layer does: env override,
        # else default to ~/.hermes. The Rust `persist_session_image` command
        # writes durable attachments here, so this dir is app-managed/trusted.
        hermes_home_env = os.environ.get("HERMES_HOME")
        if hermes_home_env:
            hermes_home = Path(hermes_home_env).expanduser()
        else:
            hermes_home = Path.home() / ".hermes"
        try:
            trusted_roots.append(hermes_home.resolve())
        except OSError:
            trusted_roots.append(hermes_home)
        for root in trusted_roots:
            if resolved_abs == root or root in resolved_abs.parents:
                return resolved_abs
    return resolve_under_cwd(raw, cwd)


def _is_reusable_empty_session(row: dict[str, Any]) -> bool:
    title = str(row.get("title") or "").strip().lower()
    return int(row.get("message_count") or 0) == 0 and title in REUSABLE_EMPTY_TITLES


def _todos_from_tools(tools: list[dict]) -> list[dict]:
    todos: list[dict] = []
    for tool in tools:
        value = tool.get("todos") if isinstance(tool, dict) else None
        if isinstance(value, list):
            todos.extend([item for item in value if isinstance(item, dict)])
    return todos


def _normalize_archive_filter(value: str | None) -> str:
    archive_filter = str(value or "exclude").strip().lower()
    if archive_filter not in ARCHIVE_FILTERS:
        raise ValueError(f"invalid archive filter: {value}")
    return archive_filter


class SessionService:
    """Facade for session lifecycle operations across state.db and desktop.db."""

    def __init__(
        self,
        hermes_home: Path,
        state: SessionStateStore,
        meta: DesktopMetaStore,
    ) -> None:
        self._hermes_home = hermes_home
        self._state = state
        self._meta = meta
        self._image_lock = threading.Lock()
        self._attached_images: dict[str, list[str]] = {}

    # ── Model resolution ──────────────────────────────────────────────────

    def resolve_default_model(self, model_hint: str | None = None) -> tuple[str | None, str | None]:
        if model_hint:
            return model_hint, None

        # Prefer the configured active model (the Model Page primary) so a new
        # conversation defaults to it, carrying its provider too. This must take
        # precedence over recent-session inheritance: otherwise a new chat would
        # adopt whatever model the last session happened to use.
        try:
            from ..readers.hermes_config import read_active_model
            active = read_active_model(self._hermes_home)
            m = active.get("model")
            if m:
                return m, active.get("provider")
        except Exception:
            log.exception("failed to read active model from config")

        # No active model configured — return None; caller will prompt user to configure.
        return None, None

    def resolve_default_permission_mode(self, *, exclude_session_id: str | None = None) -> str:
        """Return the current profile's most recent non-empty conversation mode."""
        try:
            rows = self.list_sessions(archived="exclude")
        except Exception:
            log.exception("failed to resolve recent permission mode")
            return "auto"

        for row in rows:
            sid = str(row.get("id") or "")
            if not sid or sid == exclude_session_id:
                continue
            if _is_reusable_empty_session(row) and not self._has_ui_messages(sid):
                continue
            try:
                return self._meta.get_permission_mode(sid)
            except Exception:
                log.exception("failed to read permission mode for %s", sid)
                return "auto"
        return "auto"

    def _runtime_for_session(self, session_id: str) -> dict[str, str]:
        return {
            "reasoningEffort": self._meta.get_reasoning_effort(session_id),
            "collaborationMode": self._meta.get_collaboration_mode(session_id),
        }

    # ── Session CRUD ──────────────────────────────────────────────────────

    def create_session(
        self,
        *,
        cwd: str | None = None,
        system_prompt: str | None = None,
        model: str | None = None,
        provider: str | None = None,
        permission_mode: str | None = None,
        reasoning_effort: str | None = None,
        collaboration_mode: str | None = None,
    ) -> dict:
        if not any((cwd, system_prompt, model, provider)):
            reusable = self.find_reusable_empty_session()
            if reusable:
                mode = permission_mode or self.resolve_default_permission_mode(
                    exclude_session_id=reusable["id"]
                )
                self._meta.set_permission_mode(reusable["id"], mode)
                reusable["permissionMode"] = mode
                return reusable

        sid = f"desktop_{uuid.uuid4().hex[:16]}"
        resolved_model, resolved_provider = self.resolve_default_model(model)
        resolved_permission_mode = normalize_permission_mode(
            permission_mode or self.resolve_default_permission_mode()
        )
        resolved_reasoning_effort = reasoning_effort or DEFAULT_REASONING_EFFORT
        resolved_collaboration_mode = normalize_collaboration_mode(
            collaboration_mode or DEFAULT_COLLABORATION_MODE
        )
        resolved_cwd = (
            str(resolve_existing_cwd(cwd))
            if cwd
            else str(ensure_default_workspace())
        )

        kwargs = {}
        if resolved_model:
            kwargs["model"] = resolved_model
        if system_prompt:
            kwargs["system_prompt"] = system_prompt

        self._state.create_session(sid, "desktop", cwd=resolved_cwd, **kwargs)
        self._meta.upsert_meta(
            sid,
            provider=provider or resolved_provider or "",
            permission_mode=resolved_permission_mode,
            reasoning_effort=resolved_reasoning_effort,
            collaboration_mode=resolved_collaboration_mode,
        )

        info = self._state.get_session(sid) or {}
        return {
            "session_id": sid,
            "id": sid,
            "source": "desktop",
            "model": info.get("model") or resolved_model or "",
            "provider": provider or resolved_provider or "",
            "title": info.get("title", "New Session"),
            "started_at": info.get("started_at"),
            "cwd": resolved_cwd,
            "archived": False,
            "archivedAt": None,
            "model_configured": bool(resolved_model),
            "permissionMode": resolved_permission_mode,
            "runtime": self._runtime_for_session(sid),
        }

    def find_reusable_empty_session(self) -> dict | None:
        rows = self.list_sessions()
        for row in rows:
            if _is_reusable_empty_session(row) and not self._has_ui_messages(row["id"]):
                return {
                    "session_id": row["id"],
                    "id": row["id"],
                    "source": row.get("source", "desktop"),
                    "model": row.get("model", ""),
                    "provider": row.get("provider", ""),
                    "title": row.get("title", "New Session"),
                    "started_at": row.get("started_at"),
                    "cwd": row.get("cwd") or str(ensure_default_workspace()),
                    "model_configured": bool(row.get("model")),
                    "permissionMode": self._meta.get_permission_mode(row["id"]),
                    "runtime": self._runtime_for_session(row["id"]),
                    "reused": True,
                }
        return None

    def _has_ui_messages(self, session_id: str) -> bool:
        try:
            import json
            from ..db.ui_messages import list_messages

            for row in list_messages(self._hermes_home, session_id):
                msg_type = row.get("type")
                if msg_type == "permission.mode.changed":
                    continue
                payload = json.loads(row.get("payload_json") or "{}")
                if payload.get("status") == "resolved":
                    continue
                return True
            return False
        except Exception:
            log.exception("failed to inspect desktop ui_messages for reusable session")
            return True

    def get_session(self, session_id: str) -> dict | None:
        row = self._state.get_session(session_id)
        if row is None:
            return None
        meta = self._meta.get_meta(session_id) or {}
        permission_mode = self._meta.get_permission_mode(session_id)
        runtime = self._runtime_for_session(session_id)
        return {
            "id": row.get("id", session_id),
            "source": row.get("source", "desktop"),
            "model": row.get("model", ""),
            "provider": meta.get("provider") or "",
            "title": row.get("title", "Untitled"),
            "started_at": row.get("started_at"),
            "ended_at": row.get("ended_at"),
            "message_count": row.get("message_count", 0),
            "cwd": row.get("cwd") or str(ensure_default_workspace()),
            "archived": bool(meta.get("archived")),
            "archivedAt": meta.get("archived_at"),
            "permissionMode": permission_mode,
            "runtime": runtime,
        }

    def get_session_or_404(self, session_id: str) -> dict:
        row = self.get_session(session_id)
        if row is None:
            raise SessionNotFoundError()
        return row

    def _state_desktop_rows(self, limit: int = SESSION_LIST_FETCH_LIMIT) -> list[dict]:
        return self._state.list_sessions_rich(
            source="desktop",
            include_children=False,
            order_by_last_active=True,
            limit=limit,
            include_archived=True,
        )

    def _compose_session_rows(
        self,
        rows: list[dict],
        *,
        archive_states: dict[str, dict] | None = None,
    ) -> list[dict]:
        session_ids = [r["id"] for r in rows]
        meta_providers = self._meta.get_providers(session_ids) if session_ids else {}
        permission_modes = self._meta.get_permission_modes(session_ids) if session_ids else {}
        reasoning_efforts = self._meta.get_reasoning_efforts(session_ids) if session_ids else {}
        collaboration_modes = self._meta.get_collaboration_modes(session_ids) if session_ids else {}
        archive_states = archive_states or (
            self._meta.get_archive_states(session_ids) if session_ids else {}
        )
        return [
            {
                "id": r["id"],
                "source": r.get("source", "desktop"),
                "model": r.get("model", ""),
                "provider": meta_providers.get(r["id"]) or "",
                "title": r.get("title", "Untitled"),
                "started_at": r.get("started_at"),
                "message_count": r.get("message_count", 0),
                "last_active": r.get("last_active"),
                "cwd": r.get("cwd") or str(ensure_default_workspace()),
                "archived": bool(archive_states.get(r["id"], {}).get("archived")),
                "archivedAt": archive_states.get(r["id"], {}).get("archived_at"),
                "permissionMode": permission_modes.get(r["id"], "auto"),
                "runtime": {
                    "reasoningEffort": reasoning_efforts.get(r["id"], DEFAULT_REASONING_EFFORT),
                    "collaborationMode": collaboration_modes.get(r["id"], DEFAULT_COLLABORATION_MODE),
                },
            }
            for r in rows
        ]

    def list_sessions(self, archived: str = "exclude") -> list[dict]:
        archive_filter = _normalize_archive_filter(archived)
        rows = self._state_desktop_rows()
        session_ids = [r["id"] for r in rows]
        archive_states = self._meta.get_archive_states(session_ids) if session_ids else {}
        if archive_filter == "exclude":
            rows = [r for r in rows if not archive_states.get(r["id"], {}).get("archived")]
        elif archive_filter == "only":
            archived_ids = self._meta.list_archived_session_ids(limit=SESSION_LIST_FETCH_LIMIT)
            archived_rank = {sid: idx for idx, sid in enumerate(archived_ids)}
            rows = [
                r for r in rows
                if archive_states.get(r["id"], {}).get("archived")
            ]
            rows.sort(key=lambda r: archived_rank.get(r["id"], len(archived_rank)))
        return self._compose_session_rows(
            rows[:SESSION_LIST_RETURN_LIMIT],
            archive_states=archive_states,
        )

    def set_archived(self, session_id: str, archived: bool) -> dict:
        self.get_session_or_404(session_id)
        self._meta.set_archived(session_id, archived)
        session = self.get_session_or_404(session_id)
        session["archived"] = archived
        return session

    def set_permission_mode(self, session_id: str, mode: str) -> dict:
        self.get_session_or_404(session_id)
        value = self._meta.set_permission_mode(session_id, mode)
        session = self.get_session_or_404(session_id)
        session["permissionMode"] = value
        return session

    def update_runtime(self, session_id: str, patch: dict[str, Any]) -> dict:
        self.get_session_or_404(session_id)
        if not patch or not ({"reasoningEffort", "collaborationMode"} & set(patch)):
            raise ValueError("runtime patch must include reasoningEffort or collaborationMode")
        if "reasoningEffort" in patch:
            self._meta.set_reasoning_effort(session_id, patch.get("reasoningEffort"))
        if "collaborationMode" in patch:
            self._meta.set_collaboration_mode(session_id, patch.get("collaborationMode"))
        session = self.get_session_or_404(session_id)
        session["runtime"] = self._runtime_for_session(session_id)
        return session

    def branch_session(self, session_id: str) -> dict:
        parent = self.get_session_or_404(session_id)
        permission_mode = self._meta.get_permission_mode(session_id)
        reasoning_effort = self._meta.get_reasoning_effort(session_id)
        collaboration_mode = self._meta.get_collaboration_mode(session_id)
        return self.create_session(
            cwd=parent.get("cwd"),
            model=parent.get("model") or None,
            provider=parent.get("provider") or None,
            permission_mode=permission_mode,
            reasoning_effort=reasoning_effort,
            collaboration_mode=collaboration_mode,
        )

    def rename_session(self, session_id: str, title: str) -> None:
        self.get_session_or_404(session_id)
        self._state.set_session_title(session_id, title)

    def update_cwd(self, session_id: str, cwd: str) -> str:
        self.get_session_or_404(session_id)
        resolved_cwd = str(resolve_existing_cwd(cwd))
        self._state.update_session_cwd(session_id, resolved_cwd)
        self._state.update_system_prompt(session_id, None)
        return resolved_cwd

    def delete_session(self, session_id: str) -> None:
        self.get_session_or_404(session_id)
        self._state.delete_session(session_id)
        self._meta.delete_meta(session_id)
        with self._image_lock:
            self._attached_images.pop(session_id, None)

    def attach_image(self, session_id: str, path: str) -> dict[str, Any]:
        session = self.get_session_or_404(session_id)
        from agent.image_attachments import validate_local_image_path

        # Clipboard-pasted images land in the system temp dir (outside the
        # session cwd). Allow those through the cwd gate; workspace-sourced
        # images continue to be scoped to the cwd as before.
        resolved = _resolve_image_path(path, session.get("cwd") or "")
        image_path = validate_local_image_path(resolved)
        with self._image_lock:
            images = self._attached_images.setdefault(session_id, [])
            images.append(str(image_path))
            return {"attached": True, "path": str(image_path), "count": len(images)}

    def detach_image(self, session_id: str, path: str) -> dict[str, Any]:
        session = self.get_session_or_404(session_id)
        try:
            raw = str(resolve_under_cwd(path, session.get("cwd") or ""))
        except ValueError:
            raw = str(Path(path).expanduser())
        with self._image_lock:
            images = self._attached_images.setdefault(session_id, [])
            before = len(images)
            self._attached_images[session_id] = [item for item in images if item != raw]
            return {
                "detached": len(self._attached_images[session_id]) != before,
                "count": len(self._attached_images[session_id]),
            }

    def consume_attached_images(self, session_id: str) -> list[str]:
        with self._image_lock:
            images = list(self._attached_images.get(session_id, []))
            self._attached_images[session_id] = []
            return images

    def get_messages(self, session_id: str, since_seq: int | None = None) -> list[dict]:
        import json
        from ..db.ui_messages import list_messages
        rows = list_messages(self._hermes_home, session_id, since_seq=since_seq)
        return [
            {
                "session_id": r["session_id"],
                "seq": r["seq"],
                "type": r["type"],
                "payload": json.loads(r["payload_json"]),
            }
            for r in rows
        ]

    def get_transcript(self, session_id: str) -> dict:
        from ..db.conversation_turns import list_turns
        from ..db.ui_messages import latest_seq

        turns = list_turns(self._hermes_home, session_id)
        messages: list[dict] = []
        live_turn: dict | None = None

        for turn in turns:
            turn_id = turn["turn_id"]
            user_seq = int(turn.get("user_seq") or 0)
            started_at = float(turn.get("started_at") or 0)
            user_text = str(turn.get("user_text") or "")
            slash_command = turn.get("slash_command") or None
            display_parts = turn.get("user_display_parts") or None
            if user_text or user_seq > 0:
                messages.append({
                    "id": user_seq,
                    "turn_id": turn_id,
                    "role": "user",
                    "content": user_text,
                    "reasoning": None,
                    "tool_calls": None,
                    "timestamp": started_at,
                    "token_count": None,
                    "finish_reason": None,
                    "status": "completed",
                    "slash_command": slash_command,
                    "display_parts": display_parts,
                })

            status = str(turn.get("status") or "running")
            tools = turn.get("tools") or []
            if status in {"running", "awaiting_user"}:
                pending_user_input = None
                if status == "awaiting_user":
                    try:
                        from ..db.user_input_prompts import get_pending_for_turn
                        pending = get_pending_for_turn(self._hermes_home, session_id, turn_id)
                        if pending is not None:
                            pending_user_input = {
                                "request_id": pending["request_id"],
                                "turn_id": pending["turn_id"],
                                "questions": pending.get("questions") or [],
                                "status": "pending",
                            }
                    except Exception:
                        pending_user_input = None
                live_turn = {
                    "turn_id": turn_id,
                    "status": status,
                    "content": turn.get("assistant_content") or "",
                    "reasoning": turn.get("assistant_reasoning") or "",
                    "tools": tools,
                    "blocks": turn.get("assistant_blocks") or [],
                    "todos": _todos_from_tools(tools),
                    "usage": turn.get("usage"),
                    "error": turn.get("error"),
                    "last_event_seq": turn.get("last_seq") or user_seq,
                    "started_at": started_at,
                    "updated_at": turn.get("updated_at") or started_at,
                }
                if pending_user_input is not None:
                    live_turn["pending_user_input"] = pending_user_input
                continue

            content = str(turn.get("assistant_content") or "")
            reasoning = turn.get("assistant_reasoning") or None
            should_emit_assistant = bool(content or reasoning or tools or status in {"interrupted", "failed"})
            if not should_emit_assistant:
                continue
            messages.append({
                "id": turn.get("terminal_seq") or turn.get("last_seq") or user_seq,
                "turn_id": turn_id,
                "role": "assistant",
                "content": content,
                "reasoning": reasoning,
                "tool_calls": tools or None,
                "blocks": turn.get("assistant_blocks") or None,
                "timestamp": turn.get("completed_at") or turn.get("updated_at") or started_at,
                "token_count": (turn.get("usage") or {}).get("total") if isinstance(turn.get("usage"), dict) else None,
                "finish_reason": None,
                "status": status,
                "usage": turn.get("usage"),
                "error": turn.get("error"),
            })

        return {
            "session_id": session_id,
            "max_seq": latest_seq(self._hermes_home, session_id),
            "messages": messages,
            "live_turn": live_turn,
        }

    # ── Provider management ───────────────────────────────────────────────

    def set_provider(
        self, session_id: str, provider: str, model: str | None = None
    ) -> dict:
        self.get_session_or_404(session_id)
        self._meta.set_provider(session_id, provider)
        self._state.update_system_prompt(session_id, None)

        if model:
            def _do(c):
                c.execute(
                    "UPDATE sessions SET model = ? WHERE id = ?",
                    (model, session_id),
                )
            self._state._db._execute_write(_do)
            self._state.update_system_prompt(session_id, None)

        return {"ok": True, "applied": True, "session_id": session_id, "provider": provider}

    def sync_provider_from_frontend(
        self, session_id: str, desired_provider: str | None
    ) -> str | None:
        """Persist provider change and return the *original* stored provider.

        Returns the stored provider BEFORE any update so callers can detect
        whether a change occurred (stored != desired_provider means changed).
        """
        stored = self._meta.get_provider(session_id)

        if desired_provider and stored != desired_provider:
            self._meta.set_provider(session_id, desired_provider)
            self._state.update_system_prompt(session_id, None)
            return stored

        if not stored:
            try:
                from ..readers.hermes_config import read_active_model
                active = read_active_model(self._hermes_home)
                fallback = active.get("provider")
                if fallback:
                    self._meta.set_provider(session_id, fallback)
            except Exception:
                pass

        return stored

    def sync_model_from_frontend(
        self, session_id: str, desired_model: str | None
    ) -> str | None:
        """Persist model change and return the *original* stored model.

        Returns the stored model BEFORE any update so callers can detect
        whether a change occurred.
        """
        if not desired_model:
            return None
        session = self._state.get_session(session_id)
        stored = (session or {}).get("model") if session else None
        if stored != desired_model:
            def _do(c):
                c.execute(
                    "UPDATE sessions SET model = ? WHERE id = ?",
                    (desired_model, session_id),
                )
            self._state._db._execute_write(_do)
            self._state.update_system_prompt(session_id, None)
        return stored

    def backfill_model_if_unset(self, session_id: str, model: str) -> None:
        try:
            session = self._state.get_session(session_id)
            if session and not session.get("model") and model:
                def _do(c):
                    c.execute(
                        "UPDATE sessions SET model = ? WHERE id = ?",
                        (model, session_id),
                    )
                self._state._db._execute_write(_do)
        except Exception:
            log.exception("failed to backfill model for session %s", session_id)
