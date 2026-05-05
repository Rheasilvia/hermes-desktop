"""Layer 2 overlay loader. Corruption is recovered, never propagated."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..util.atomic_write import atomic_write_json
from ..util.filelock import file_lock

log = logging.getLogger(__name__)


def _domain_path(hermes_home: Path, domain: str) -> Path:
    return Path(hermes_home) / "desktop" / "overlays" / f"{domain}.json"


def _backup_name(path: Path) -> Path:
    iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    return path.with_name(f"{path.name}.corrupt-{iso}")


def load(hermes_home: Path, domain: str) -> dict[str, dict[str, Any]]:
    path = _domain_path(hermes_home, domain)
    if not path.exists():
        return {}
    try:
        with file_lock(path, exclusive=False):
            with open(path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
    except json.JSONDecodeError as exc:
        backup = _backup_name(path)
        try:
            os.rename(path, backup)
        except OSError:
            log.warning("Overlay corrupt and unrenamable: %s", path)
        log.warning("Overlay corrupt; backed up to %s: %s", backup, exc)
        return {}
    if not isinstance(payload, dict):
        return {}
    return payload


def update(
    hermes_home: Path,
    domain: str,
    entity_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    path = _domain_path(hermes_home, domain)
    with file_lock(path, exclusive=True):
        current: dict[str, dict[str, Any]] = {}
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    loaded = json.load(fh)
                if isinstance(loaded, dict):
                    current = loaded
            except json.JSONDecodeError:
                current = {}
        entry = dict(current.get(entity_id, {}))
        entry.update(patch)
        current[entity_id] = entry
        atomic_write_json(path, current)
        return entry
