"""SQLite connection manager for desktop.db."""
from __future__ import annotations

import sqlite3
from pathlib import Path


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
    conn.commit()
