"""SessionStateService — wraps hermes_state.SessionDB with SessionStateStore protocol.

Handles all state.db session operations.  Does NOT touch desktop.db.
"""

from __future__ import annotations

from typing import Any


class SessionStateService:
    """Thin wrapper around hermes_state.SessionDB."""

    def __init__(self, session_db: Any) -> None:
        self._db = session_db

    def get_session(self, session_id: str) -> dict | None:
        return self._db.get_session(session_id)

    def create_session(self, session_id: str, source: str, **kwargs: Any) -> None:
        self._db.create_session(session_id, source, **kwargs)

    def update_session_cwd(self, session_id: str, cwd: str) -> None:
        self._db.update_session_cwd(session_id, cwd)

    def update_system_prompt(self, session_id: str, system_prompt: str | None) -> None:
        self._db.update_system_prompt(session_id, system_prompt)

    def delete_session(self, session_id: str) -> None:
        self._db.delete_session(session_id)

    def set_session_title(self, session_id: str, title: str) -> None:
        self._db.set_session_title(session_id, title)

    def list_sessions_rich(
        self,
        source: str,
        include_children: bool,
        order_by_last_active: bool,
        limit: int,
        include_archived: bool = False,
    ) -> list[dict]:
        return self._db.list_sessions_rich(
            source=source,
            include_children=include_children,
            order_by_last_active=order_by_last_active,
            limit=limit,
            include_archived=include_archived,
        )

    def get_messages_as_conversation(self, session_id: str) -> list[dict]:
        return self._db.get_messages_as_conversation(session_id)
