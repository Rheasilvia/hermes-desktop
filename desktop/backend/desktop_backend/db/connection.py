"""SQLite connection manager for desktop.db."""
from __future__ import annotations

import sqlite3
from pathlib import Path

from .schema import SCHEMA_VERSION, SESSION_DESKTOP_META_DDL


def get_db_path(hermes_home: Path) -> Path:
    return Path(hermes_home) / "desktop" / "desktop.db"


def connect(hermes_home: Path) -> sqlite3.Connection:
    path = get_db_path(hermes_home)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS desktop_state (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL
        )
        """
    )
    row = conn.execute("SELECT version FROM schema_version").fetchone()
    if row is None:
        conn.execute("INSERT INTO schema_version (version) VALUES (?)", (1,))
        current_version = 1
    else:
        current_version = row["version"]

    _migrate(conn, current_version)
    conn.commit()


def _migrate(conn: sqlite3.Connection, current_version: int) -> None:
    if current_version < 2:
        conn.executescript(SESSION_DESKTOP_META_DDL)
        conn.execute("UPDATE schema_version SET version = ?", (SCHEMA_VERSION,))
