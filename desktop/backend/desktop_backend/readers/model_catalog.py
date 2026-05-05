# SNAPSHOT:
#   source: hermes_cli/model_catalog.py
#   upstream_sha: 69e4387e527e45fcd715dab02e4c3857872e1641
#   copied_at: 2026-05-05
#   stripped:
#     - HTTP fetch logic (we only read the cached JSON)
#     - CLI argument handling
#   resync_when:
#     - upstream model catalog schema gains new top-level keys
#     - upstream relocates the cache file
"""Pure read-only parser for ~/.hermes/cache/model_catalog.json."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .cron_reader import L1CorruptError  # re-use type

CATALOG_FILE = "cache/model_catalog.json"


def _file(hermes_home: Path) -> Path:
    return Path(hermes_home) / CATALOG_FILE


def load_catalog(hermes_home: Path) -> dict[str, Any]:
    path = _file(hermes_home)
    if not path.exists():
        return {"providers": [], "fetched_at": None}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except json.JSONDecodeError as exc:
        raise L1CorruptError(str(path), str(exc)) from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("providers"), list):
        raise L1CorruptError(str(path), "expected {providers: [...]}")
    payload.setdefault("fetched_at", None)
    return payload


def get_providers(hermes_home: Path) -> list[dict[str, Any]]:
    return load_catalog(hermes_home)["providers"]
