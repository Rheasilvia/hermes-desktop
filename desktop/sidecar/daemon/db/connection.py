"""SQLite connection manager for desktop.db."""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from pathlib import Path

from .schema import SCHEMA_VERSION, SESSION_DESKTOP_META_DDL, V3_DDL

log = logging.getLogger(__name__)


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
        conn.execute("UPDATE schema_version SET version = ?", (2,))
        current_version = 2

    if current_version < 3:
        conn.executescript(V3_DDL)
        _import_json_overlays(conn)
        _import_json_settings(conn)
        conn.execute("UPDATE schema_version SET version = ?", (3,))

    if current_version < 4:
        try:
            conn.execute("ALTER TABLE session_desktop_meta ADD COLUMN provider TEXT")
        except Exception:
            pass  # column already exists
        conn.execute("UPDATE schema_version SET version = ?", (4,))

    if current_version < 5:
        try:
            conn.execute("ALTER TABLE model_overlays ADD COLUMN models_config TEXT")
        except Exception:
            pass  # column already exists
        conn.execute("UPDATE schema_version SET version = ?", (5,))
        current_version = 5

    if current_version < 6:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS session_desktop_meta_v6 (
                session_id     TEXT PRIMARY KEY,
                pinned         INTEGER NOT NULL DEFAULT 0,
                archived       INTEGER NOT NULL DEFAULT 0,
                last_opened_at REAL,
                created_at     REAL NOT NULL DEFAULT (strftime('%s','now')),
                provider       TEXT
            );

            INSERT OR REPLACE INTO session_desktop_meta_v6
                (session_id, pinned, archived, last_opened_at, created_at, provider)
            SELECT session_id, pinned, archived, last_opened_at, created_at, provider
            FROM session_desktop_meta;

            DROP TABLE session_desktop_meta;
            ALTER TABLE session_desktop_meta_v6 RENAME TO session_desktop_meta;

            CREATE INDEX IF NOT EXISTS idx_sdm_pinned      ON session_desktop_meta(pinned) WHERE pinned = 1;
            CREATE INDEX IF NOT EXISTS idx_sdm_last_opened ON session_desktop_meta(last_opened_at DESC);
            CREATE INDEX IF NOT EXISTS idx_sdm_archived    ON session_desktop_meta(archived);
            """
        )
        conn.execute("UPDATE schema_version SET version = ?", (6,))
        current_version = 6

    if current_version < 7:
        try:
            conn.execute(
                "ALTER TABLE session_desktop_meta "
                "ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'auto'"
            )
        except Exception:
            pass  # column already exists
        conn.execute(
            "UPDATE session_desktop_meta "
            "SET permission_mode = 'auto' "
            "WHERE permission_mode IS NULL OR permission_mode NOT IN ('ask', 'auto', 'full')"
        )
        conn.execute("UPDATE schema_version SET version = ?", (7,))
        current_version = 7

    if current_version < 8:
        try:
            conn.execute(
                "ALTER TABLE session_desktop_meta "
                "ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT 'medium'"
            )
        except Exception:
            pass  # column already exists
        conn.execute(
            "UPDATE session_desktop_meta "
            "SET reasoning_effort = 'medium' "
            "WHERE reasoning_effort IS NULL "
            "OR TRIM(reasoning_effort) = '' "
            "OR LOWER(reasoning_effort) NOT IN ('none', 'minimal', 'low', 'medium', 'high', 'xhigh')"
        )
        conn.execute("UPDATE schema_version SET version = ?", (8,))


def _overlay_json_path(hermes_home: str, domain: str) -> Path:
    return Path(hermes_home) / "desktop" / "overlays" / f"{domain}.json"


def _settings_json_path(hermes_home: str) -> Path:
    return Path(hermes_home) / "desktop" / "settings.json"


def _import_json_overlays(conn: sqlite3.Connection) -> None:
    """Import model.json and cron.json overlays into SQLite, then rename to .bak."""
    hermes_home = _resolve_hermes_home(conn)

    for domain in ("model", "cron"):
        path = _overlay_json_path(hermes_home, domain)
        if not path.exists():
            continue
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError):
            log.warning("Skipping corrupt overlay: %s", path)
            continue
        if not isinstance(data, dict):
            continue

        table = f"{domain}_overlays"
        id_col = "provider_id" if domain == "model" else "job_id"
        for entity_id, entry in data.items():
            if not isinstance(entry, dict):
                continue
            cols = [id_col]
            vals = [entity_id]
            for key, val in entry.items():
                cols.append(key)
                vals.append(val)
            placeholders = ", ".join(["?"] * len(vals))
            col_names = ", ".join(cols)
            conn.execute(
                f"INSERT OR REPLACE INTO {table} ({col_names}) VALUES ({placeholders})",
                vals,
            )

        bak = path.with_suffix(path.suffix + ".bak")
        try:
            os.rename(path, bak)
            log.info("Migrated %s → %s", path.name, bak.name)
        except OSError:
            log.warning("Failed to rename %s to .bak", path)


def _import_json_settings(conn: sqlite3.Connection) -> None:
    """Import settings.json into desktop_settings table, then rename to .bak."""
    hermes_home = _resolve_hermes_home(conn)
    path = _settings_json_path(hermes_home)
    if not path.exists():
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError):
        log.warning("Skipping corrupt settings: %s", path)
        return
    if not isinstance(data, dict):
        return

    for key, value in data.items():
        conn.execute(
            "INSERT OR REPLACE INTO desktop_settings (key, value) VALUES (?, ?)",
            (key, json.dumps(value)),
        )

    bak = path.with_suffix(path.suffix + ".bak")
    try:
        os.rename(path, bak)
        log.info("Migrated %s → %s", path.name, bak.name)
    except OSError:
        log.warning("Failed to rename %s to .bak", path)


def _resolve_hermes_home(conn: sqlite3.Connection) -> str:
    """Infer HERMES_HOME from the connected database path."""
    db_path = Path(
        conn.execute("PRAGMA database_list").fetchone()[2] or ""
    )
    return str(db_path.parent.parent)
