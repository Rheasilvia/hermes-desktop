"""DAO for the ui_messages table in a separate ~/.hermes/desktop/desktop_ui.db.

This database is fully decoupled from the hermes core state.db.  Every row
is an append-only log of what the UI needs to render — streaming deltas,
tool lifecycle, approval/clarify requests, and turn-level errors.

Schema (idempotent, migrated on first access):
    CREATE TABLE IF NOT EXISTS ui_messages (
        session_id  TEXT    NOT NULL,
        seq         INTEGER NOT NULL,
        type        TEXT    NOT NULL,
        payload_json TEXT   NOT NULL,
        created_at  REAL    NOT NULL,
        PRIMARY KEY (session_id, seq)
    );

Thread safety: calls with a new connection each time (WAL mode).
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

UI_MESSAGES_DDL = """
CREATE TABLE IF NOT EXISTS ui_messages (
    session_id   TEXT    NOT NULL,
    seq          INTEGER NOT NULL,
    type         TEXT    NOT NULL,
    payload_json TEXT    NOT NULL,
    created_at   REAL    NOT NULL,
    PRIMARY KEY (session_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_ui_msgs_sid_seq
    ON ui_messages(session_id, seq);
"""


def _get_db_path(hermes_home: Path) -> Path:
    return hermes_home / "desktop" / "desktop_ui.db"


def _connect(hermes_home: Path) -> sqlite3.Connection:
    path = _get_db_path(hermes_home)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(UI_MESSAGES_DDL)
    conn.commit()


def append(
    hermes_home: Path,
    session_id: str,
    msg_type: str,
    payload: Dict[str, Any],
) -> int:
    """Append a new ui_messages row.  Returns the assigned seq for this row.

    seq is auto-incremented per-session.  The caller must use the returned
    seq when publishing to the event bus (seq must come from DB first).
    """
    conn = _connect(hermes_home)
    try:
        _ensure_schema(conn)

        # Obtain next seq for this session (COALESCE + 1)
        row = conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq "
            "FROM ui_messages WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        seq = row["next_seq"]

        conn.execute(
            "INSERT INTO ui_messages (session_id, seq, type, payload_json, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (session_id, seq, msg_type, json.dumps(payload, ensure_ascii=False), time.time()),
        )
        conn.commit()
        return seq
    finally:
        conn.close()


def list_messages(
    hermes_home: Path,
    session_id: str,
    since_seq: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Return all ui_messages for a session, optionally since a given seq.

    Returns rows as dicts with keys: session_id, seq, type, payload_json, created_at.
    Payload is NOT deserialized — callers do that at the boundary they need it.
    """
    conn = _connect(hermes_home)
    try:
        _ensure_schema(conn)

        if since_seq is not None:
            rows = conn.execute(
                "SELECT session_id, seq, type, payload_json, created_at "
                "FROM ui_messages "
                "WHERE session_id = ? AND seq > ? "
                "ORDER BY seq ASC",
                (session_id, since_seq),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT session_id, seq, type, payload_json, created_at "
                "FROM ui_messages "
                "WHERE session_id = ? "
                "ORDER BY seq ASC",
                (session_id,),
            ).fetchall()

        return [dict(r) for r in rows]
    finally:
        conn.close()


def latest_seq(hermes_home: Path, session_id: str) -> int:
    """Return the latest seq for a session, or 0 if no messages exist."""
    conn = _connect(hermes_home)
    try:
        _ensure_schema(conn)
        row = conn.execute(
            "SELECT COALESCE(MAX(seq), 0) AS max_seq "
            "FROM ui_messages WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return row["max_seq"]
    finally:
        conn.close()
