"""Durable storage for desktop Plan Mode request_user_input prompts."""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .ui_messages import _connect, _ensure_schema, append_in_conn


USER_INPUT_PROMPTS_DDL = """
CREATE TABLE IF NOT EXISTS user_input_prompts (
    request_id     TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL,
    turn_id        TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'pending',
    questions_json TEXT NOT NULL,
    answers_json   TEXT,
    request_seq    INTEGER NOT NULL,
    response_seq   INTEGER,
    created_at     REAL NOT NULL,
    answered_at    REAL,
    resumed_at     REAL,
    failed_at      REAL,
    error          TEXT
);

CREATE INDEX IF NOT EXISTS idx_user_input_prompts_pending
    ON user_input_prompts(status, created_at);

CREATE INDEX IF NOT EXISTS idx_user_input_prompts_session_turn
    ON user_input_prompts(session_id, turn_id);
"""


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _json_loads(value: str | None, fallback: Any) -> Any:
    if value is None:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return fallback


def ensure_schema(conn: sqlite3.Connection) -> None:
    _ensure_schema(conn)
    conn.executescript(USER_INPUT_PROMPTS_DDL)
    conn.commit()


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "request_id": row["request_id"],
        "session_id": row["session_id"],
        "turn_id": row["turn_id"],
        "status": row["status"],
        "questions": _json_loads(row["questions_json"], []),
        "answers": _json_loads(row["answers_json"], None),
        "request_seq": row["request_seq"],
        "response_seq": row["response_seq"],
        "created_at": row["created_at"],
        "answered_at": row["answered_at"],
        "resumed_at": row["resumed_at"],
        "failed_at": row["failed_at"],
        "error": row["error"],
    }


def create_request(
    hermes_home: Path,
    *,
    session_id: str,
    turn_id: str,
    request_id: str,
    questions: list[dict[str, Any]],
) -> tuple[dict[str, Any], int]:
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        now = time.time()
        payload = {
            "request_id": request_id,
            "turn_id": turn_id,
            "questions": questions,
            "status": "pending",
        }
        seq = append_in_conn(
            conn,
            session_id,
            "user_input.request",
            payload,
            turn_id=turn_id,
            created_at=now,
            ensure=False,
        )
        conn.execute(
            """
            INSERT INTO user_input_prompts (
                request_id, session_id, turn_id, status, questions_json, request_seq, created_at
            )
            VALUES (?, ?, ?, 'pending', ?, ?, ?)
            """,
            (request_id, session_id, turn_id, _json_dumps(questions), seq, now),
        )
        conn.commit()
        return payload, seq
    finally:
        conn.close()


def answer_request(
    hermes_home: Path,
    *,
    session_id: str,
    request_id: str,
    answers: dict[str, Any],
) -> tuple[dict[str, Any] | None, int | None, bool]:
    """Persist an answer.

    Returns (prompt, response_seq, changed). changed is True only for the first
    successful transition out of pending.
    """
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM user_input_prompts WHERE request_id = ? AND session_id = ?",
            (request_id, session_id),
        ).fetchone()
        if row is None:
            return None, None, False

        prompt = _row_to_dict(row)
        if row["status"] != "pending":
            return prompt, row["response_seq"], False

        now = time.time()
        payload = {
            "request_id": request_id,
            "turn_id": row["turn_id"],
            "answers": answers,
            "status": "answered",
        }
        seq = append_in_conn(
            conn,
            row["session_id"],
            "user_input.response",
            payload,
            turn_id=row["turn_id"],
            created_at=now,
            ensure=False,
        )
        conn.execute(
            """
            UPDATE user_input_prompts
            SET status = 'answered',
                answers_json = ?,
                response_seq = ?,
                answered_at = ?,
                error = NULL
            WHERE request_id = ?
            """,
            (_json_dumps(answers), seq, now, request_id),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM user_input_prompts WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        return _row_to_dict(row), seq, True
    finally:
        conn.close()


def mark_resumed(hermes_home: Path, request_id: str) -> bool:
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        now = time.time()
        cur = conn.execute(
            """
            UPDATE user_input_prompts
            SET status = 'resumed', resumed_at = ?, error = NULL
            WHERE request_id = ? AND status IN ('pending', 'answered')
            """,
            (now, request_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def claim_recovery(hermes_home: Path, request_id: str) -> dict[str, Any] | None:
    """Atomically claim an answered prompt for restart recovery."""
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute(
            "SELECT * FROM user_input_prompts WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        if row is None or row["status"] != "answered":
            return None
        now = time.time()
        cur = conn.execute(
            """
            UPDATE user_input_prompts
            SET status = 'resumed', resumed_at = ?, error = NULL
            WHERE request_id = ? AND status = 'answered'
            """,
            (now, request_id),
        )
        conn.commit()
        if cur.rowcount <= 0:
            return None
        row = conn.execute(
            "SELECT * FROM user_input_prompts WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


def mark_failed(hermes_home: Path, request_id: str, error: str) -> bool:
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        cur = conn.execute(
            """
            UPDATE user_input_prompts
            SET status = 'failed', failed_at = ?, error = ?
            WHERE request_id = ? AND status != 'failed'
            """,
            (time.time(), error, request_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def cancel_turn(hermes_home: Path, session_id: str, turn_id: str, reason: str) -> list[str]:
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        rows = conn.execute(
            """
            SELECT request_id FROM user_input_prompts
            WHERE session_id = ? AND turn_id = ? AND status IN ('pending', 'answered')
            """,
            (session_id, turn_id),
        ).fetchall()
        request_ids = [str(row["request_id"]) for row in rows]
        if request_ids:
            conn.executemany(
                """
                UPDATE user_input_prompts
                SET status = 'failed', failed_at = ?, error = ?
                WHERE request_id = ?
                """,
                [(time.time(), reason, request_id) for request_id in request_ids],
            )
        conn.commit()
        return request_ids
    finally:
        conn.close()


def list_pending(hermes_home: Path) -> list[dict[str, Any]]:
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        rows = conn.execute(
            """
            SELECT * FROM user_input_prompts
            WHERE status = 'pending'
            ORDER BY created_at ASC
            """
        ).fetchall()
        return [item for row in rows if (item := _row_to_dict(row)) is not None]
    finally:
        conn.close()


def get_pending_for_turn(hermes_home: Path, session_id: str, turn_id: str) -> dict[str, Any] | None:
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        row = conn.execute(
            """
            SELECT * FROM user_input_prompts
            WHERE session_id = ? AND turn_id = ? AND status = 'pending'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (session_id, turn_id),
        ).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()


def get_request(hermes_home: Path, request_id: str) -> dict[str, Any] | None:
    conn = _connect(hermes_home)
    try:
        ensure_schema(conn)
        row = conn.execute(
            "SELECT * FROM user_input_prompts WHERE request_id = ?",
            (request_id,),
        ).fetchone()
        return _row_to_dict(row)
    finally:
        conn.close()
