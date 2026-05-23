"""Protocol interfaces for service-layer dependency inversion.

Services depend on these protocols (not concrete classes), enabling clean
mocking in unit tests via structural subtyping (zero runtime overhead).
"""

from __future__ import annotations

from typing import Any, Protocol


class SessionStateStore(Protocol):
    """Interface for state.db session operations.

    Implemented by SessionStateService (wraps hermes_state.SessionDB).
    """

    def get_session(self, session_id: str) -> dict | None:
        """Return session dict or None."""
        ...

    def create_session(self, session_id: str, source: str, **kwargs: Any) -> None:
        """Insert a new session row."""
        ...

    def delete_session(self, session_id: str) -> None:
        """Delete session and all child rows."""
        ...

    def set_session_title(self, session_id: str, title: str) -> None:
        """Update the session title column."""
        ...

    def list_sessions_rich(
        self,
        source: str,
        include_children: bool,
        order_by_last_active: bool,
        limit: int,
    ) -> list[dict]:
        """Return list of session dicts with metadata (message_count, last_active, etc.)."""
        ...

    def get_messages_as_conversation(self, session_id: str) -> list[dict]:
        """Return LLM-format conversation messages for the session."""
        ...


class DesktopMetaStore(Protocol):
    """Interface for session_desktop_meta operations in desktop.db.

    Implemented by DesktopMetaService (wraps db/connection.py).
    """

    def get_meta(self, session_id: str) -> dict | None:
        """Return the session_desktop_meta row as a dict, or None."""
        ...

    def upsert_meta(
        self,
        session_id: str,
        workspace_path: str | None = None,
        provider: str | None = None,
    ) -> None:
        """Insert or update a session_desktop_meta row."""
        ...

    def delete_meta(self, session_id: str) -> None:
        """Delete the session_desktop_meta row."""
        ...

    def set_provider(self, session_id: str, provider: str) -> None:
        """Update only the provider column."""
        ...

    def get_provider(self, session_id: str) -> str | None:
        """Return the stored provider string, or None."""
        ...


class UIMessageStore(Protocol):
    """Interface for ui_messages operations.

    Implemented by UIMessageService (wraps db/ui_messages.py DAO).
    """

    def append(self, session_id: str, msg_type: str, payload: dict) -> int:
        """Append a ui_messages row. Returns the assigned seq."""
        ...

    def list_messages(
        self, session_id: str, since_seq: int | None = None
    ) -> list[dict]:
        """Return ui_messages rows with session_id, seq, type, payload_json fields."""
        ...

    def clear_session(self, session_id: str) -> None:
        """Delete all ui_messages rows for a session."""
        ...
