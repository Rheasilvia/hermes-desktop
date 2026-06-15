from __future__ import annotations

import sqlite3

from daemon.db.connection import connect, ensure_schema, get_db_path
from daemon.services.desktop_meta_service import DesktopMetaService


def test_fresh_schema_defaults_reasoning_effort_to_medium(tmp_path):
    conn = connect(tmp_path)
    try:
        ensure_schema(conn)
        conn.execute("INSERT INTO session_desktop_meta (session_id) VALUES (?)", ("sess-1",))
        row = conn.execute(
            "SELECT reasoning_effort FROM session_desktop_meta WHERE session_id = ?",
            ("sess-1",),
        ).fetchone()
        version = conn.execute("SELECT version FROM schema_version").fetchone()["version"]
        assert version == 8
        assert row["reasoning_effort"] == "medium"
    finally:
        conn.close()


def test_v7_schema_migrates_reasoning_effort_to_medium(tmp_path):
    path = get_db_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(path)
    try:
        raw.executescript(
            """
            CREATE TABLE desktop_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE schema_version (version INTEGER NOT NULL);
            INSERT INTO schema_version (version) VALUES (7);
            CREATE TABLE session_desktop_meta (
                session_id      TEXT PRIMARY KEY,
                pinned          INTEGER NOT NULL DEFAULT 0,
                archived        INTEGER NOT NULL DEFAULT 0,
                last_opened_at  REAL,
                created_at      REAL NOT NULL DEFAULT (strftime('%s','now')),
                provider        TEXT,
                permission_mode TEXT NOT NULL DEFAULT 'auto'
            );
            INSERT INTO session_desktop_meta (session_id, permission_mode)
            VALUES ('sess-old', 'auto');
            """
        )
        raw.commit()
    finally:
        raw.close()

    conn = connect(tmp_path)
    try:
        ensure_schema(conn)
        row = conn.execute(
            "SELECT reasoning_effort FROM session_desktop_meta WHERE session_id = ?",
            ("sess-old",),
        ).fetchone()
        version = conn.execute("SELECT version FROM schema_version").fetchone()["version"]
        assert version == 8
        assert row["reasoning_effort"] == "medium"
    finally:
        conn.close()


def test_invalid_stored_reasoning_effort_normalizes_to_medium(tmp_path):
    conn = connect(tmp_path)
    try:
        ensure_schema(conn)
        conn.execute(
            "INSERT INTO session_desktop_meta (session_id, reasoning_effort) VALUES (?, ?)",
            ("sess-invalid", "turbo"),
        )
        conn.commit()
    finally:
        conn.close()

    service = DesktopMetaService(tmp_path)
    assert service.get_reasoning_effort("sess-invalid") == "medium"
