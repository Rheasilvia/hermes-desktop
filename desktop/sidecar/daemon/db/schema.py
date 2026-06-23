"""Schema constants for desktop.db."""
from __future__ import annotations

SCHEMA_VERSION = 11

SESSION_DESKTOP_META_DDL = """
CREATE TABLE IF NOT EXISTS session_desktop_meta (
    session_id     TEXT PRIMARY KEY,
    pinned         INTEGER NOT NULL DEFAULT 0,
    archived       INTEGER NOT NULL DEFAULT 0,
    archived_at    REAL,
    last_opened_at REAL,
    created_at     REAL NOT NULL DEFAULT (strftime('%s','now')),
    provider       TEXT,
    permission_mode TEXT NOT NULL DEFAULT 'auto',
    reasoning_effort TEXT NOT NULL DEFAULT 'medium'
);

CREATE INDEX IF NOT EXISTS idx_sdm_pinned      ON session_desktop_meta(pinned) WHERE pinned = 1;
CREATE INDEX IF NOT EXISTS idx_sdm_last_opened ON session_desktop_meta(last_opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_sdm_archived    ON session_desktop_meta(archived);
CREATE INDEX IF NOT EXISTS idx_sdm_archived_at ON session_desktop_meta(archived, archived_at DESC) WHERE archived = 1;
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

MCP_SERVER_META_DDL = """
CREATE TABLE IF NOT EXISTS mcp_server_meta (
    server_name      TEXT PRIMARY KEY,
    pinned           INTEGER NOT NULL DEFAULT 0,
    note             TEXT,
    display_order    INTEGER,
    last_selected_at TEXT,
    updated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_mcp_meta_pinned ON mcp_server_meta(pinned) WHERE pinned = 1;
CREATE INDEX IF NOT EXISTS idx_mcp_meta_order  ON mcp_server_meta(display_order);
"""

PROFILE_DDL = """
CREATE TABLE IF NOT EXISTS desktop_profiles (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    hermes_home  TEXT NOT NULL,
    is_default   INTEGER NOT NULL DEFAULT 0,
    archived     INTEGER NOT NULL DEFAULT 0,
    created_at   REAL NOT NULL DEFAULT (strftime('%s','now')),
    updated_at   REAL NOT NULL DEFAULT (strftime('%s','now')),
    last_used_at REAL
);

CREATE INDEX IF NOT EXISTS idx_desktop_profiles_archived ON desktop_profiles(archived);
CREATE INDEX IF NOT EXISTS idx_desktop_profiles_default  ON desktop_profiles(is_default) WHERE is_default = 1;

CREATE TABLE IF NOT EXISTS desktop_profile_state (
    profile_id TEXT NOT NULL,
    key        TEXT NOT NULL,
    value_json TEXT NOT NULL,
    PRIMARY KEY (profile_id, key)
);
"""
