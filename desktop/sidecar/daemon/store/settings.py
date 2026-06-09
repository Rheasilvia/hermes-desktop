"""Layer 3: desktop settings backed by SQLite (v3)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..db.connection import connect, ensure_schema

SCHEMA_VERSION = 1

_DEFAULTS: dict[str, Any] = {
    "schema_version": SCHEMA_VERSION,
    "ui": {
        "theme": "system",
        "verbose_logging": False,
    },
}

_RUNTIME_CONFIG_KEYS = {
    "tts",
    "stt",
    "voice",
    "model",
    "agent",
    "security",
    "memory",
    "browser",
}


class SchemaVersionMismatch(RuntimeError):
    pass


class RuntimeConfigKeyError(RuntimeError):
    def __init__(self, key: str):
        super().__init__(f"Runtime config key '{key}' belongs in /desktop/api/config")
        self.key = key


def load(hermes_home: Path) -> dict[str, Any]:
    conn = connect(hermes_home)
    ensure_schema(conn)
    try:
        rows = conn.execute("SELECT key, value FROM desktop_settings").fetchall()
    finally:
        conn.close()

    if not rows:
        return json.loads(json.dumps(_DEFAULTS))

    payload: dict[str, Any] = {}
    for row in rows:
        try:
            payload[row["key"]] = json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            payload[row["key"]] = row["value"]

    payload.setdefault("schema_version", SCHEMA_VERSION)
    return payload


def save(hermes_home: Path, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise SchemaVersionMismatch(
            f"expected schema_version={SCHEMA_VERSION}, got {payload.get('schema_version')!r}"
        )
    for key in payload:
        if key in _RUNTIME_CONFIG_KEYS:
            raise RuntimeConfigKeyError(key)
    conn = connect(hermes_home)
    ensure_schema(conn)
    try:
        conn.execute("DELETE FROM desktop_settings")
        for key, value in payload.items():
            conn.execute(
                "INSERT INTO desktop_settings (key, value) VALUES (?, ?)",
                (key, json.dumps(value)),
            )
        conn.commit()
    finally:
        conn.close()
    return payload
