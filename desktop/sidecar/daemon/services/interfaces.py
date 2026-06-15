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
        """Update the session title for this session id."""
        ...

    def update_session_cwd(self, session_id: str, cwd: str) -> None:
        """Update the session cwd column."""
        ...

    def update_system_prompt(self, session_id: str, system_prompt: str | None) -> None:
        """Update the cached assembled system prompt snapshot."""
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
        provider: str | None = None,
        permission_mode: str = "auto",
        reasoning_effort: str = "medium",
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

    def get_providers(self, session_ids: list[str]) -> dict[str, str | None]:
        """Batch fetch providers for multiple sessions."""
        ...

    def set_permission_mode(self, session_id: str, mode: str) -> str:
        """Persist the conversation permission mode and return the normalized value."""
        ...

    def get_permission_mode(self, session_id: str) -> str:
        """Return the stored permission mode for a session, defaulting to auto."""
        ...

    def get_permission_modes(self, session_ids: list[str]) -> dict[str, str]:
        """Batch fetch permission modes for multiple sessions."""
        ...

    def set_reasoning_effort(self, session_id: str, effort: str) -> str:
        """Persist the conversation reasoning effort and return the normalized value."""
        ...

    def get_reasoning_effort(self, session_id: str) -> str:
        """Return the stored reasoning effort for a session, defaulting to medium."""
        ...

    def get_reasoning_efforts(self, session_ids: list[str]) -> dict[str, str]:
        """Batch fetch reasoning efforts for multiple sessions."""
        ...


class UIMessageStore(Protocol):
    """Interface for ui_messages operations.

    Implemented by UIMessageService (wraps db/ui_messages.py DAO).
    """

    def append(
        self,
        session_id: str,
        msg_type: str,
        payload: dict,
        turn_id: str | None = None,
    ) -> int:
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
