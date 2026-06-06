"""DAO helpers for the desktop conversation_turns read model.

The ui_messages table remains the append-only event log.  This module projects
those raw events into one canonical row per assistant turn so the desktop UI can
hydrate a conversation without re-inferring turn boundaries in the frontend.
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List


CONVERSATION_TURNS_DDL = """
CREATE TABLE IF NOT EXISTS conversation_turns (
    session_id          TEXT    NOT NULL,
    turn_id             TEXT    NOT NULL,
    user_seq            INTEGER NOT NULL,
    user_text           TEXT    NOT NULL DEFAULT '',
    status              TEXT    NOT NULL DEFAULT 'running',
    assistant_content   TEXT    NOT NULL DEFAULT '',
    assistant_reasoning TEXT    NOT NULL DEFAULT '',
    tools_json          TEXT    NOT NULL DEFAULT '[]',
    usage_json          TEXT,
    error_json          TEXT,
    started_at          REAL    NOT NULL,
    updated_at          REAL    NOT NULL,
    completed_at        REAL,
    terminal_seq        INTEGER,
    last_seq            INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, turn_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_turns_sid_user_seq
    ON conversation_turns(session_id, user_seq);

CREATE INDEX IF NOT EXISTS idx_conversation_turns_sid_status
    ON conversation_turns(session_id, status);
"""

TERMINAL_STATUSES = {"completed", "interrupted", "failed"}


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


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(CONVERSATION_TURNS_DDL)
    cols = {row["name"] for row in conn.execute("PRAGMA table_info(conversation_turns)").fetchall()}
    if "last_seq" not in cols:
        conn.execute("ALTER TABLE conversation_turns ADD COLUMN last_seq INTEGER NOT NULL DEFAULT 0")


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: str | None, fallback: Any) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def _turn_row(conn: sqlite3.Connection, session_id: str, turn_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM conversation_turns WHERE session_id = ? AND turn_id = ?",
        (session_id, turn_id),
    ).fetchone()


def _ensure_turn(
    conn: sqlite3.Connection,
    session_id: str,
    turn_id: str,
    *,
    user_seq: int,
    user_text: str = "",
    created_at: float,
) -> None:
    conn.execute(
        """
        INSERT OR IGNORE INTO conversation_turns (
            session_id, turn_id, user_seq, user_text, status, started_at, updated_at, last_seq
        )
        VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
        """,
        (session_id, turn_id, user_seq, user_text, created_at, created_at, user_seq),
    )
    if user_text:
        conn.execute(
            """
            UPDATE conversation_turns
            SET user_text = ?, user_seq = CASE WHEN user_seq = 0 THEN ? ELSE user_seq END,
                updated_at = ?, last_seq = max(last_seq, ?)
            WHERE session_id = ? AND turn_id = ?
            """,
            (user_text, user_seq, created_at, user_seq, session_id, turn_id),
        )


def _set_terminal(
    conn: sqlite3.Connection,
    session_id: str,
    turn_id: str,
    *,
    status: str,
    seq: int,
    now: float,
    assistant_content: str | None = None,
    usage: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
) -> None:
    row = _turn_row(conn, session_id, turn_id)
    if row is not None and row["status"] in TERMINAL_STATUSES:
        return

    fields = [
        "status = ?",
        "updated_at = ?",
        "completed_at = ?",
        "terminal_seq = ?",
        "last_seq = max(last_seq, ?)",
    ]
    values: list[Any] = [status, now, now, seq, seq]
    if assistant_content is not None:
        fields.append("assistant_content = ?")
        values.append(assistant_content)
    if usage is not None:
        fields.append("usage_json = ?")
        values.append(_json_dumps(usage))
    if error is not None:
        fields.append("error_json = ?")
        values.append(_json_dumps(error))
    values.extend([session_id, turn_id])
    conn.execute(
        f"UPDATE conversation_turns SET {', '.join(fields)} WHERE session_id = ? AND turn_id = ?",
        values,
    )


def _load_tools(row: sqlite3.Row | None) -> list[dict[str, Any]]:
    if row is None:
        return []
    tools = _json_loads(row["tools_json"], [])
    return tools if isinstance(tools, list) else []


def _store_tools(
    conn: sqlite3.Connection,
    session_id: str,
    turn_id: str,
    tools: list[dict[str, Any]],
    now: float,
    seq: int,
) -> None:
    conn.execute(
        """
        UPDATE conversation_turns
        SET tools_json = ?, updated_at = ?, last_seq = max(last_seq, ?)
        WHERE session_id = ? AND turn_id = ?
        """,
        (_json_dumps(tools), now, seq, session_id, turn_id),
    )


def _upsert_tool(
    tools: list[dict[str, Any]],
    tool_id: str,
    *,
    name: str = "",
) -> dict[str, Any]:
    for tool in tools:
        if tool.get("id") == tool_id:
            if name:
                tool["name"] = name
            return tool
    tool = {
        "id": tool_id,
        "name": name,
        "arguments": {},
        "status": "running",
        "inputPreview": None,
        "outputSummary": None,
        "durationMs": None,
    }
    tools.append(tool)
    return tool


def _parse_args_preview(preview: str | None) -> dict[str, Any]:
    if not preview:
        return {}
    try:
        data = json.loads(preview)
    except (TypeError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def apply_event(
    conn: sqlite3.Connection,
    session_id: str,
    turn_id: str | None,
    seq: int,
    msg_type: str,
    payload: Dict[str, Any],
    created_at: float,
) -> None:
    """Apply a raw ui_messages event to the canonical turn projection."""
    if not turn_id:
        return

    if msg_type == "user":
        _ensure_turn(
            conn,
            session_id,
            turn_id,
            user_seq=seq,
            user_text=str(payload.get("text") or ""),
            created_at=created_at,
        )
        return

    _ensure_turn(conn, session_id, turn_id, user_seq=0, created_at=created_at)
    row = _turn_row(conn, session_id, turn_id)
    if row is not None and row["status"] in TERMINAL_STATUSES:
        return

    if msg_type == "message.delta":
        conn.execute(
            """
            UPDATE conversation_turns
            SET assistant_content = assistant_content || ?, updated_at = ?, last_seq = max(last_seq, ?)
            WHERE session_id = ? AND turn_id = ?
            """,
            (str(payload.get("text") or ""), created_at, seq, session_id, turn_id),
        )
        return

    if msg_type == "reasoning.delta":
        conn.execute(
            """
            UPDATE conversation_turns
            SET assistant_reasoning = assistant_reasoning || ?, updated_at = ?, last_seq = max(last_seq, ?)
            WHERE session_id = ? AND turn_id = ?
            """,
            (str(payload.get("text") or ""), created_at, seq, session_id, turn_id),
        )
        return

    if msg_type in {"tool.start", "tool.generating", "tool.complete", "tool.error"}:
        row = _turn_row(conn, session_id, turn_id)
        tools = _load_tools(row)
        tool_id = str(payload.get("tool_id") or payload.get("name") or "")
        if not tool_id:
            return
        tool = _upsert_tool(tools, tool_id, name=str(payload.get("name") or ""))
        if msg_type == "tool.start":
            tool["status"] = "running"
            if payload.get("args_preview") is not None and tool.get("inputPreview") is None:
                tool["inputPreview"] = str(payload.get("args_preview") or "")
        elif msg_type == "tool.generating":
            tool["status"] = "generating"
            tool["inputPreview"] = f"{tool.get('inputPreview') or ''}{payload.get('text') or ''}"
        elif msg_type == "tool.complete":
            tool["status"] = "complete"
            tool["outputSummary"] = payload.get("summary")
            if payload.get("duration_s") is not None:
                tool["durationMs"] = round(float(payload.get("duration_s") or 0) * 1000)
            tool["arguments"] = _parse_args_preview(tool.get("inputPreview"))
            if isinstance(payload.get("todos"), list):
                tool["todos"] = payload.get("todos")
        else:
            tool["status"] = "error"
            if payload.get("duration_s") is not None:
                tool["durationMs"] = round(float(payload.get("duration_s") or 0) * 1000)
        _store_tools(conn, session_id, turn_id, tools, created_at, seq)
        return

    if msg_type == "message.complete":
        text = str(payload.get("text") or "")
        if not text and row is not None:
            text = str(row["assistant_content"] or "")
        usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else None
        _set_terminal(
            conn,
            session_id,
            turn_id,
            status="completed",
            seq=seq,
            now=created_at,
            assistant_content=text,
            usage=usage,
        )
        return

    if msg_type == "turn_error":
        error = dict(payload)
        text = str(payload.get("message") or payload.get("error") or "Turn error")
        _set_terminal(
            conn,
            session_id,
            turn_id,
            status="failed",
            seq=seq,
            now=created_at,
            assistant_content=text,
            error=error,
        )
        return

    if msg_type == "turn.interrupted":
        _set_terminal(
            conn,
            session_id,
            turn_id,
            status="interrupted",
            seq=seq,
            now=created_at,
            error=dict(payload),
        )
        return

    conn.execute(
        """
        UPDATE conversation_turns
        SET updated_at = ?, last_seq = max(last_seq, ?)
        WHERE session_id = ? AND turn_id = ?
        """,
        (created_at, seq, session_id, turn_id),
    )


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "session_id": row["session_id"],
        "turn_id": row["turn_id"],
        "user_seq": row["user_seq"],
        "user_text": row["user_text"],
        "status": row["status"],
        "assistant_content": row["assistant_content"],
        "assistant_reasoning": row["assistant_reasoning"],
        "tools": _json_loads(row["tools_json"], []),
        "usage": _json_loads(row["usage_json"], None),
        "error": _json_loads(row["error_json"], None),
        "started_at": row["started_at"],
        "updated_at": row["updated_at"],
        "completed_at": row["completed_at"],
        "terminal_seq": row["terminal_seq"],
        "last_seq": row["last_seq"],
    }


def list_turns(hermes_home: Path, session_id: str) -> List[dict[str, Any]]:
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        rows = conn.execute(
            """
            SELECT * FROM conversation_turns
            WHERE session_id = ?
            ORDER BY user_seq ASC, started_at ASC
            """,
            (session_id,),
        ).fetchall()
        return [_row_to_dict(row) for row in rows]
    finally:
        conn.close()


def clear_session(hermes_home: Path, session_id: str) -> None:
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        conn.execute("DELETE FROM conversation_turns WHERE session_id = ?", (session_id,))
        conn.commit()
    finally:
        conn.close()


def clear_all(conn: sqlite3.Connection) -> None:
    ensure_schema(conn)
    conn.execute("DELETE FROM conversation_turns")
