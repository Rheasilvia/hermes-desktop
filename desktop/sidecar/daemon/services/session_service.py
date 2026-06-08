"""SessionService — facade composing SessionStateService + DesktopMetaService.

Routers depend on this single service for all session lifecycle operations.
It orchestrates both data stores (state.db and desktop.db) behind one API.
"""

from __future__ import annotations

import logging
import threading
import uuid
from pathlib import Path
from typing import Any

from .exceptions import SessionNotFoundError
from .interfaces import DesktopMetaStore, SessionStateStore
from .path_validation import resolve_existing_cwd, resolve_under_cwd
from .desktop_meta_service import normalize_permission_mode

log = logging.getLogger(__name__)

DEFAULT_WORKSPACE = Path.home() / "HermesAgentWorkspace"
REUSABLE_EMPTY_TITLES = frozenset(
    {"", "new session", "untitled", "untitled new conversation"}
)


def ensure_default_workspace() -> Path:
    """Return the desktop default workspace, creating it on first use."""
    DEFAULT_WORKSPACE.mkdir(parents=True, exist_ok=True)
    return DEFAULT_WORKSPACE


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
            rows = self._state.list_sessions_rich(
                source="desktop",
                include_children=False,
                order_by_last_active=True,
                limit=50,
            )
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

    # ── Session CRUD ──────────────────────────────────────────────────────

    def create_session(
        self,
        *,
        cwd: str | None = None,
        system_prompt: str | None = None,
        model: str | None = None,
        provider: str | None = None,
        permission_mode: str | None = None,
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
            "model_configured": bool(resolved_model),
            "permissionMode": resolved_permission_mode,
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
        meta_providers = self._meta.get_providers([session_id])
        permission_mode = self._meta.get_permission_mode(session_id)
        return {
            "id": row.get("id", session_id),
            "source": row.get("source", "desktop"),
            "model": row.get("model", ""),
            "provider": meta_providers.get(session_id) or "",
            "title": row.get("title", "Untitled"),
            "started_at": row.get("started_at"),
            "ended_at": row.get("ended_at"),
            "message_count": row.get("message_count", 0),
            "cwd": row.get("cwd") or str(ensure_default_workspace()),
            "permissionMode": permission_mode,
        }

    def get_session_or_404(self, session_id: str) -> dict:
        row = self.get_session(session_id)
        if row is None:
            raise SessionNotFoundError()
        return row

    def list_sessions(self) -> list[dict]:
        rows = self._state.list_sessions_rich(
            source="desktop",
            include_children=False,
            order_by_last_active=True,
            limit=50,
        )
        session_ids = [r["id"] for r in rows]
        meta_providers = self._meta.get_providers(session_ids) if session_ids else {}
        permission_modes = self._meta.get_permission_modes(session_ids) if session_ids else {}
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
                "permissionMode": permission_modes.get(r["id"], "auto"),
            }
            for r in rows
        ]

    def set_permission_mode(self, session_id: str, mode: str) -> dict:
        self.get_session_or_404(session_id)
        value = self._meta.set_permission_mode(session_id, mode)
        session = self.get_session_or_404(session_id)
        session["permissionMode"] = value
        return session

    def branch_session(self, session_id: str) -> dict:
        parent = self.get_session_or_404(session_id)
        permission_mode = self._meta.get_permission_mode(session_id)
        return self.create_session(
            cwd=parent.get("cwd"),
            model=parent.get("model") or None,
            provider=parent.get("provider") or None,
            permission_mode=permission_mode,
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

        image_path = validate_local_image_path(resolve_under_cwd(path, session.get("cwd") or ""))
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
            if status == "running":
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
