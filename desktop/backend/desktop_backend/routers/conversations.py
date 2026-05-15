"""CRUD for session_desktop_meta in desktop.db."""
from __future__ import annotations

import time
from typing import List

from fastapi import APIRouter, HTTPException, Request

from ..db.connection import connect, ensure_schema
from ..schemas.conversation import SessionMetaResponse, SessionMetaUpsert

router = APIRouter()


def _get_conn(request: Request):
    cfg = request.app.state.cfg
    conn = connect(cfg.hermes_home)
    ensure_schema(conn)
    return conn


@router.get("/sessions/meta", response_model=List[SessionMetaResponse])
def list_session_meta(request: Request):
    conn = _get_conn(request)
    rows = conn.execute("SELECT * FROM session_desktop_meta").fetchall()
    return [_row_to_response(r) for r in rows]


@router.get("/sessions/{session_id}/meta", response_model=SessionMetaResponse)
def get_session_meta(session_id: str, request: Request):
    conn = _get_conn(request)
    row = conn.execute(
        "SELECT * FROM session_desktop_meta WHERE session_id = ?", (session_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="SESSION_META_NOT_FOUND")
    return _row_to_response(row)


@router.put("/sessions/{session_id}/meta", response_model=SessionMetaResponse)
def upsert_session_meta(session_id: str, body: SessionMetaUpsert, request: Request):
    conn = _get_conn(request)
    now = time.time()
    conn.execute(
        """
        INSERT INTO session_desktop_meta
            (session_id, workspace_path, pinned, archived, last_opened_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            workspace_path = excluded.workspace_path,
            pinned         = excluded.pinned,
            archived       = excluded.archived,
            last_opened_at = excluded.last_opened_at
        """,
        (
            session_id,
            body.workspace_path,
            int(body.pinned),
            int(body.archived),
            now,
            now,
        ),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM session_desktop_meta WHERE session_id = ?", (session_id,)
    ).fetchone()
    return _row_to_response(row)


@router.delete("/sessions/{session_id}/meta", status_code=204)
def delete_session_meta(session_id: str, request: Request):
    conn = _get_conn(request)
    conn.execute(
        "DELETE FROM session_desktop_meta WHERE session_id = ?", (session_id,)
    )
    conn.commit()


def _row_to_response(row) -> SessionMetaResponse:
    return SessionMetaResponse(
        session_id=row["session_id"],
        workspace_path=row["workspace_path"],
        pinned=bool(row["pinned"]),
        archived=bool(row["archived"]),
        last_opened_at=row["last_opened_at"],
        created_at=row["created_at"],
    )
