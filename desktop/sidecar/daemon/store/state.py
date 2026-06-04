"""Layer 3: desktop state persisted in desktop.db (SQLite)."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from ..db.connection import connect, ensure_schema
from ..db.schema import SCHEMA_VERSION

_DEFAULTS: dict[str, Any] = {
    "schema_version": SCHEMA_VERSION,
    "last_open_route": "/",
    "last_session_id": None,
    "last_workspace_path": None,
    "window": {"w": 1280, "h": 800},
}


def load(hermes_home: Path) -> dict[str, Any]:
    conn = connect(hermes_home)
    ensure_schema(conn)
    try:
        rows = conn.execute("SELECT key, value FROM desktop_state").fetchall()
        if not rows:
            return dict(_DEFAULTS)
        payload: dict[str, Any] = {}
        for row in rows:
            payload[row["key"]] = row["value"]
        payload.setdefault("schema_version", SCHEMA_VERSION)
        payload.setdefault("last_open_route", "/")
        payload.setdefault("last_session_id", None)
        payload.setdefault("last_workspace_path", None)
        payload.setdefault("window", {"w": 1280, "h": 800})
        return payload
    finally:
        conn.close()


def save(hermes_home: Path, payload: dict[str, Any]) -> dict[str, Any]:
    conn = connect(hermes_home)
    ensure_schema(conn)
    try:
        conn.execute("DELETE FROM desktop_state")
        for key, value in payload.items():
            conn.execute(
                "INSERT INTO desktop_state (key, value) VALUES (?, ?)",
                (key, value),
            )
        conn.commit()
    finally:
        conn.close()
    return payload
