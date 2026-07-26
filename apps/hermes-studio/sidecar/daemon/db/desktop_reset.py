"""One-time desktop conversation reset for the turn projection schema."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from .connection import connect, ensure_schema

log = logging.getLogger(__name__)

RESET_KEY = "desktop_turn_projection_reset_version"
RESET_VERSION = "1"


def _reset_already_applied(conn) -> bool:
    row = conn.execute(
        "SELECT value FROM desktop_state WHERE key = ?",
        (RESET_KEY,),
    ).fetchone()
    return bool(row and row["value"] == RESET_VERSION)


def _mark_reset_applied(conn) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO desktop_state (key, value) VALUES (?, ?)",
        (RESET_KEY, RESET_VERSION),
    )


def _delete_desktop_sessions(session_db: Any) -> int:
    def _do(conn):
        rows = conn.execute("SELECT id FROM sessions WHERE source = 'desktop'").fetchall()
        ids = [row["id"] for row in rows]
        if not ids:
            return 0
        placeholders = ",".join("?" for _ in ids)
        conn.execute(
            f"UPDATE sessions SET parent_session_id = NULL WHERE parent_session_id IN ({placeholders})",
            ids,
        )
        conn.execute(
            f"DELETE FROM messages WHERE session_id IN ({placeholders})",
            ids,
        )
        conn.execute(
            f"DELETE FROM sessions WHERE id IN ({placeholders})",
            ids,
        )
        return len(ids)

    count = session_db._execute_write(_do)
    log.info("[desktop-reset] deleted %d desktop state.db sessions", count)
    return int(count or 0)


def ensure_desktop_conversation_reset(hermes_home: Path, session_db: Any) -> bool:
    """Clear old desktop conversation data once, preserving configuration.

    Returns True when this call applied the reset.
    """
    conn = connect(hermes_home)
    try:
        ensure_schema(conn)
        if _reset_already_applied(conn):
            return False

        _delete_desktop_sessions(session_db)

        from .ui_messages import clear_all as clear_ui_messages
        clear_ui_messages(hermes_home)

        conn.execute("DELETE FROM session_desktop_meta")
        _mark_reset_applied(conn)
        conn.commit()
        log.info("[desktop-reset] applied turn projection reset version %s", RESET_VERSION)
        return True
    finally:
        conn.close()
