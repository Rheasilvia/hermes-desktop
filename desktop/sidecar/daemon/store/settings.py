"""Layer 3: desktop settings backed by SQLite (v3)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..db.connection import connect, ensure_schema

SCHEMA_VERSION = 1
DEFAULT_DESKTOP_SANDBOX: dict[str, str] = {
    "mode": "workspace-write",
    "network_access": "restricted",
}
_SANDBOX_MODES = {"read-only", "workspace-write"}
_SANDBOX_NETWORK_ACCESS = {"restricted", "enabled"}

_DEFAULTS: dict[str, Any] = {
    "schema_version": SCHEMA_VERSION,
    "ui": {
        "theme": "system",
        "verbose_logging": False,
    },
    "desktop_sandbox": DEFAULT_DESKTOP_SANDBOX,
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


class InvalidDesktopSandboxSettings(RuntimeError):
    pass


def _default_desktop_sandbox() -> dict[str, str]:
    return dict(DEFAULT_DESKTOP_SANDBOX)


def normalize_desktop_sandbox(value: Any, *, strict: bool = False) -> dict[str, str]:
    """Return a validated desktop sandbox policy.

    Stored desktop settings are user-editable and migrated from older versions, so
    reads recover to the default. Writes are strict so bad UI/API payloads do not
    persist a misleading policy.
    """
    if value is None:
        return _default_desktop_sandbox()
    if not isinstance(value, dict):
        if strict:
            raise InvalidDesktopSandboxSettings("desktop_sandbox must be an object")
        return _default_desktop_sandbox()

    mode = value.get("mode", DEFAULT_DESKTOP_SANDBOX["mode"])
    network_access = value.get("network_access", DEFAULT_DESKTOP_SANDBOX["network_access"])
    if mode not in _SANDBOX_MODES:
        if strict:
            raise InvalidDesktopSandboxSettings(
                "desktop_sandbox.mode must be 'read-only' or 'workspace-write'"
            )
        mode = DEFAULT_DESKTOP_SANDBOX["mode"]
    if network_access not in _SANDBOX_NETWORK_ACCESS:
        if strict:
            raise InvalidDesktopSandboxSettings(
                "desktop_sandbox.network_access must be 'restricted' or 'enabled'"
            )
        network_access = DEFAULT_DESKTOP_SANDBOX["network_access"]
    return {"mode": str(mode), "network_access": str(network_access)}


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
    payload["desktop_sandbox"] = normalize_desktop_sandbox(payload.get("desktop_sandbox"))
    return payload


def save(hermes_home: Path, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise SchemaVersionMismatch(
            f"expected schema_version={SCHEMA_VERSION}, got {payload.get('schema_version')!r}"
        )
    for key in payload:
        if key in _RUNTIME_CONFIG_KEYS:
            raise RuntimeConfigKeyError(key)
    payload = dict(payload)
    payload["desktop_sandbox"] = normalize_desktop_sandbox(
        payload.get("desktop_sandbox"),
        strict=True,
    )
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
