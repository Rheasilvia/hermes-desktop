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
            "SELECT reasoning_effort, collaboration_mode FROM session_desktop_meta WHERE session_id = ?",
            ("sess-1",),
        ).fetchone()
        version = conn.execute("SELECT version FROM schema_version").fetchone()["version"]
        meta_table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_server_meta'"
        ).fetchone()
        assert version == 11
        assert row["reasoning_effort"] == "medium"
        assert row["collaboration_mode"] == "default"
        assert meta_table is not None
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(session_desktop_meta)").fetchall()
        }
        assert "archived_at" in columns
        assert "collaboration_mode" in columns
        index = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_sdm_archived_at'"
        ).fetchone()
        assert index is not None
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
            "SELECT reasoning_effort, collaboration_mode FROM session_desktop_meta WHERE session_id = ?",
            ("sess-old",),
        ).fetchone()
        version = conn.execute("SELECT version FROM schema_version").fetchone()["version"]
        assert version == 11
        assert row["reasoning_effort"] == "medium"
        assert row["collaboration_mode"] == "default"
    finally:
        conn.close()


def test_v8_schema_migrates_mcp_server_meta(tmp_path):
    path = get_db_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(path)
    try:
        raw.executescript(
            """
            CREATE TABLE desktop_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE schema_version (version INTEGER NOT NULL);
            INSERT INTO schema_version (version) VALUES (8);
            CREATE TABLE session_desktop_meta (
                session_id       TEXT PRIMARY KEY,
                pinned           INTEGER NOT NULL DEFAULT 0,
                archived         INTEGER NOT NULL DEFAULT 0,
                last_opened_at   REAL,
                created_at       REAL NOT NULL DEFAULT (strftime('%s','now')),
                provider         TEXT,
                permission_mode  TEXT NOT NULL DEFAULT 'auto',
                reasoning_effort TEXT NOT NULL DEFAULT 'medium'
            );
            """
        )
        raw.commit()
    finally:
        raw.close()

    conn = connect(tmp_path)
    try:
        ensure_schema(conn)
        version = conn.execute("SELECT version FROM schema_version").fetchone()["version"]
        table = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_server_meta'"
        ).fetchone()
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(session_desktop_meta)").fetchall()
        }
        assert version == 11
        assert table is not None
        assert "collaboration_mode" in columns
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


def test_set_archived_preserved_across_runtime_upsert(tmp_path):
    service = DesktopMetaService(tmp_path)

    service.upsert_meta("sess-archive", provider="openai")
    service.set_archived("sess-archive", True)
    service.upsert_meta(
        "sess-archive",
        provider="anthropic",
        permission_mode="full",
        reasoning_effort="high",
    )

    meta = service.get_meta("sess-archive")
    assert meta is not None
    assert meta["archived"] == 1
    assert meta["archived_at"] is not None
    assert meta["provider"] == "anthropic"
    assert meta["collaboration_mode"] == "default"
    assert service.get_archived_map(["sess-archive"]) == {"sess-archive": True}

    service.set_archived("sess-archive", False)
    restored = service.get_meta("sess-archive")
    assert restored is not None
    assert restored["archived"] == 0
    assert restored["archived_at"] is None


def test_v9_schema_migrates_archived_at_and_index(tmp_path):
    path = get_db_path(tmp_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(path)
    try:
        raw.executescript(
            """
            CREATE TABLE desktop_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE schema_version (version INTEGER NOT NULL);
            INSERT INTO schema_version (version) VALUES (9);
            CREATE TABLE session_desktop_meta (
                session_id       TEXT PRIMARY KEY,
                pinned           INTEGER NOT NULL DEFAULT 0,
                archived         INTEGER NOT NULL DEFAULT 0,
                last_opened_at   REAL,
                created_at       REAL NOT NULL DEFAULT (strftime('%s','now')),
                provider         TEXT,
                permission_mode  TEXT NOT NULL DEFAULT 'auto',
                reasoning_effort TEXT NOT NULL DEFAULT 'medium'
            );
            INSERT INTO session_desktop_meta
                (session_id, archived, last_opened_at, created_at)
            VALUES
                ('archived-old', 1, 1234.0, 1200.0),
                ('active-old', 0, 1300.0, 1300.0);
            """
        )
        raw.commit()
    finally:
        raw.close()

    conn = connect(tmp_path)
    try:
        ensure_schema(conn)
        version = conn.execute("SELECT version FROM schema_version").fetchone()["version"]
        archived = conn.execute(
            "SELECT archived_at FROM session_desktop_meta WHERE session_id = ?",
            ("archived-old",),
        ).fetchone()
        active = conn.execute(
            "SELECT archived_at FROM session_desktop_meta WHERE session_id = ?",
            ("active-old",),
        ).fetchone()
        query_plan = conn.execute(
            """
            EXPLAIN QUERY PLAN
            SELECT session_id
            FROM session_desktop_meta
            WHERE archived = 1
            ORDER BY archived_at DESC
            """
        ).fetchall()
        migrated = conn.execute(
            "SELECT collaboration_mode FROM session_desktop_meta WHERE session_id = ?",
            ("archived-old",),
        ).fetchone()
        assert version == 11
        assert archived["archived_at"] == 1234.0
        assert migrated["collaboration_mode"] == "default"
        assert active["archived_at"] is None
        assert any("idx_sdm_archived_at" in row["detail"] for row in query_plan)
    finally:
        conn.close()
