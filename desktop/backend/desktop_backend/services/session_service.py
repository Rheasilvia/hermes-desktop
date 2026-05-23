"""SessionService — facade composing SessionStateService + DesktopMetaService.

Routers depend on this single service for all session lifecycle operations.
It orchestrates both data stores (state.db and desktop.db) behind one API.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from .exceptions import SessionNotFoundError
from .interfaces import DesktopMetaStore, SessionStateStore

log = logging.getLogger(__name__)


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

    # ── Model resolution ──────────────────────────────────────────────────

    def resolve_default_model(self, model_hint: str | None = None) -> tuple[str | None, str | None]:
        if model_hint:
            return model_hint, None

        try:
            rows = self._state.list_sessions_rich(
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

        try:
            from ..readers.hermes_config import read_active_model
            active = read_active_model(self._hermes_home)
            m = active.get("model")
            if m:
                return m, active.get("provider")
        except Exception:
            log.exception("failed to read active model from config")

        return None, None

    # ── Session CRUD ──────────────────────────────────────────────────────

    def create_session(
        self,
        *,
        workspace_path: str | None = None,
        system_prompt: str | None = None,
        model: str | None = None,
        provider: str | None = None,
    ) -> dict:
        sid = f"desktop_{uuid.uuid4().hex[:16]}"
        resolved_model, resolved_provider = self.resolve_default_model(model)

        kwargs = {}
        if resolved_model:
            kwargs["model"] = resolved_model
        if system_prompt:
            kwargs["system_prompt"] = system_prompt

        self._state.create_session(sid, "desktop", **kwargs)
        self._meta.upsert_meta(sid, workspace_path=workspace_path, provider=provider or resolved_provider or "")

        info = self._state.get_session(sid) or {}
        return {
            "session_id": sid,
            "id": sid,
            "source": "desktop",
            "model": info.get("model") or resolved_model or "",
            "provider": resolved_provider or "",
            "title": info.get("title", "New Session"),
            "started_at": info.get("started_at"),
            "workspace_path": workspace_path,
            "model_configured": bool(resolved_model),
        }

    def get_session(self, session_id: str) -> dict | None:
        row = self._state.get_session(session_id)
        if row is None:
            return None
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

    def rename_session(self, session_id: str, title: str) -> None:
        self.get_session_or_404(session_id)
        self._state.set_session_title(session_id, title)

    def delete_session(self, session_id: str) -> None:
        self.get_session_or_404(session_id)
        self._state.delete_session(session_id)
        self._meta.delete_meta(session_id)

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

    # ── Provider management ───────────────────────────────────────────────

    def set_provider(
        self, session_id: str, provider: str, model: str | None = None
    ) -> dict:
        self.get_session_or_404(session_id)
        self._meta.set_provider(session_id, provider)

        if model:
            def _do(c):
                c.execute(
                    "UPDATE sessions SET model = ? WHERE id = ?",
                    (model, session_id),
                )
            self._state._db._execute_write(_do)

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
