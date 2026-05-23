"""UIMessageService — wraps db/ui_messages.py DAO with UIMessageStore protocol.

Injected via Depends into AgentExecutionService and conversation routers.
"""

from __future__ import annotations

from pathlib import Path


class UIMessageService:
    """Thin service wrapper around db/ui_messages.py DAO functions."""

    def __init__(self, hermes_home: Path) -> None:
        self._hermes_home = hermes_home

    def append(self, session_id: str, msg_type: str, payload: dict) -> int:
        from ..db.ui_messages import append as _append
        return _append(self._hermes_home, session_id, msg_type, payload)

    def list_messages(self, session_id: str, since_seq: int | None = None) -> list[dict]:
        from ..db.ui_messages import list_messages as _list
        return _list(self._hermes_home, session_id, since_seq=since_seq)

    def clear_session(self, session_id: str) -> None:
        from ..db.ui_messages import clear_session as _clear
        _clear(self._hermes_home, session_id)
