"""Schema constants for desktop.db."""
from __future__ import annotations

SCHEMA_VERSION = 3

SESSION_DESKTOP_META_DDL = """
CREATE TABLE IF NOT EXISTS session_desktop_meta (
    session_id     TEXT PRIMARY KEY,
    workspace_path TEXT,
    pinned         INTEGER NOT NULL DEFAULT 0,
    archived       INTEGER NOT NULL DEFAULT 0,
    last_opened_at REAL,
    created_at     REAL NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE INDEX IF NOT EXISTS idx_sdm_pinned      ON session_desktop_meta(pinned) WHERE pinned = 1;
CREATE INDEX IF NOT EXISTS idx_sdm_last_opened ON session_desktop_meta(last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_sdm_archived    ON session_desktop_meta(archived);
"""

V3_DDL = """
CREATE TABLE IF NOT EXISTS model_overlays (
    provider_id     TEXT PRIMARY KEY,
    visible         INTEGER DEFAULT 1,
    display_order   INTEGER,
    note            TEXT,
    base_url        TEXT,
    api_key         TEXT,
    api_key_env     TEXT,
    api_key_source  TEXT,
    base_url_source TEXT,
    display_name    TEXT,
    updated_at      TEXT
);

CREATE TABLE IF NOT EXISTS cron_overlays (
    job_id     TEXT PRIMARY KEY,
    pinned     INTEGER DEFAULT 0,
    color      TEXT,
    note       TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS desktop_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""
