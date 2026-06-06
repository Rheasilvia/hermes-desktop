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

UI_MESSAGES_TABLE_DDL = """
CREATE TABLE IF NOT EXISTS ui_messages (
    session_id   TEXT    NOT NULL,
    seq          INTEGER NOT NULL,
    type         TEXT    NOT NULL,
    turn_id      TEXT,
    payload_json TEXT    NOT NULL,
    created_at   REAL    NOT NULL,
    PRIMARY KEY (session_id, seq)
);

CREATE TABLE IF NOT EXISTS session_path_approvals (
    session_id   TEXT NOT NULL,
    approval_key TEXT NOT NULL,
    created_at   REAL NOT NULL,
    PRIMARY KEY (session_id, approval_key)
);
"""

UI_MESSAGES_INDEX_DDL = """
CREATE INDEX IF NOT EXISTS idx_ui_msgs_sid_seq
    ON ui_messages(session_id, seq);

CREATE INDEX IF NOT EXISTS idx_ui_msgs_sid_turn_seq
    ON ui_messages(session_id, turn_id, seq);
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
    conn.executescript(UI_MESSAGES_TABLE_DDL)
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(ui_messages)").fetchall()}
    if "turn_id" not in cols:
        conn.execute("ALTER TABLE ui_messages ADD COLUMN turn_id TEXT")
    conn.executescript(UI_MESSAGES_INDEX_DDL)
    from .conversation_turns import ensure_schema as ensure_turn_schema
    ensure_turn_schema(conn)
    conn.commit()


def append(
    hermes_home: Path,
    session_id: str,
    msg_type: str,
    payload: Dict[str, Any],
    turn_id: str | None = None,
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

        created_at = time.time()
        payload_to_store = dict(payload)
        if turn_id:
            payload_to_store.setdefault("turn_id", turn_id)

        conn.execute(
            "INSERT INTO ui_messages (session_id, seq, type, turn_id, payload_json, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (
                session_id,
                seq,
                msg_type,
                turn_id,
                json.dumps(payload_to_store, ensure_ascii=False),
                created_at,
            ),
        )
        from .conversation_turns import apply_event
        apply_event(conn, session_id, turn_id, seq, msg_type, payload_to_store, created_at)
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

    Returns rows as dicts with keys: session_id, seq, type, turn_id,
    payload_json, created_at.
    Payload is NOT deserialized — callers do that at the boundary they need it.
    """
    conn = _connect(hermes_home)
    try:
        _ensure_schema(conn)

        if since_seq is not None:
            rows = conn.execute(
                "SELECT session_id, seq, type, turn_id, payload_json, created_at "
                "FROM ui_messages "
                "WHERE session_id = ? AND seq > ? "
                "ORDER BY seq ASC",
                (session_id, since_seq),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT session_id, seq, type, turn_id, payload_json, created_at "
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


def clear_session(hermes_home: Path, session_id: str) -> None:
    """Delete all ui_messages rows for a session."""
    conn = _connect(hermes_home)
    try:
        _ensure_schema(conn)
        conn.execute(
            "DELETE FROM ui_messages WHERE session_id = ?",
            (session_id,),
        )
        conn.execute(
            "DELETE FROM conversation_turns WHERE session_id = ?",
            (session_id,),
        )
        conn.commit()
    finally:
        conn.close()


def clear_all(hermes_home: Path) -> None:
    """Delete all desktop UI event-log/read-model rows."""
    conn = _connect(hermes_home)
    try:
        _ensure_schema(conn)
        conn.execute("DELETE FROM ui_messages")
        conn.execute("DELETE FROM conversation_turns")
        conn.execute("DELETE FROM session_path_approvals")
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# session_path_approvals helpers
# ---------------------------------------------------------------------------

def save_session_approval(hermes_home: Path, session_id: str, approval_key: str) -> None:
    """Persist a session-level path approval key to the DB (idempotent)."""
    conn = _connect(hermes_home)
    try:
        _ensure_schema(conn)
        conn.execute(
            "INSERT OR IGNORE INTO session_path_approvals (session_id, approval_key, created_at) "
            "VALUES (?, ?, ?)",
            (session_id, approval_key, time.time()),
        )
        conn.commit()
    finally:
        conn.close()


def load_session_approvals(hermes_home: Path, session_id: str) -> set:
    """Return all persisted approval keys for a session."""
    conn = _connect(hermes_home)
    try:
        _ensure_schema(conn)
        rows = conn.execute(
            "SELECT approval_key FROM session_path_approvals WHERE session_id = ?",
            (session_id,),
        ).fetchall()
        return {row["approval_key"] for row in rows}
    finally:
        conn.close()


def clear_session_approvals_db(hermes_home: Path, session_id: str) -> None:
    """Delete all persisted approval keys for a session."""
    conn = _connect(hermes_home)
    try:
        _ensure_schema(conn)
        conn.execute(
            "DELETE FROM session_path_approvals WHERE session_id = ?",
            (session_id,),
        )
        conn.commit()
    finally:
        conn.close()
