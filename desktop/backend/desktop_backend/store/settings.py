"""Layer 3: settings.json. Schema-versioned. Atomic writes."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..util.atomic_write import atomic_write_json
from ..util.filelock import file_lock

SCHEMA_VERSION = 1

_DEFAULTS: dict[str, Any] = {
    "schema_version": SCHEMA_VERSION,
    "ui": {
        "theme": "system",
        "verbose_logging": False,
    },
}


class SchemaVersionMismatch(RuntimeError):
    pass


def _path(hermes_home: Path) -> Path:
    return Path(hermes_home) / "desktop" / "settings.json"


def load(hermes_home: Path) -> dict[str, Any]:
    path = _path(hermes_home)
    if not path.exists():
        return json.loads(json.dumps(_DEFAULTS))  # deep copy
    with file_lock(path, exclusive=False):
        with open(path, "r", encoding="utf-8") as fh:
            try:
                payload = json.load(fh)
            except json.JSONDecodeError:
                return json.loads(json.dumps(_DEFAULTS))
    if not isinstance(payload, dict):
        return json.loads(json.dumps(_DEFAULTS))
    payload.setdefault("schema_version", SCHEMA_VERSION)
    return payload


def save(hermes_home: Path, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise SchemaVersionMismatch(
            f"expected schema_version={SCHEMA_VERSION}, got {payload.get('schema_version')!r}"
        )
    path = _path(hermes_home)
    with file_lock(path, exclusive=True):
        atomic_write_json(path, payload)
    return payload
