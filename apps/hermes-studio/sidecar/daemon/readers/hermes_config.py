# SNAPSHOT:
"""Pure read-only parsers for sections of ~/.hermes/config.yaml.

These intentionally avoid importing the full config loader (which pulls in the
whole agent dependency graph); they parse only the YAML keys the desktop sidecar
needs, so they stay cheap and side-effect-free.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def _load_config(hermes_home: Path) -> dict[str, Any]:
    """Load and return the config.yaml as a dict, or {} on any failure."""
    config_path = Path(hermes_home) / "config.yaml"
    if not config_path.exists():
        return {}
    try:
        with open(config_path, "r", encoding="utf-8") as fh:
            data: Any = yaml.safe_load(fh)
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def read_active_model(hermes_home: Path) -> dict[str, str | None]:
    data = _load_config(hermes_home)
    section = data.get("model")
    if not isinstance(section, dict):
        return {"provider": None, "model": None}
    return {
        "provider": section.get("provider") or None,
        "model": section.get("default") or None,
    }


def read_security_config(hermes_home: Path) -> dict[str, Any]:
    """Read the ``security`` section used by the desktop terminal approval gate.

    Returns a dict with keys:
      - ``dangerous_commands``: list[str] — command fragments that must always
        require approval (defaults to None when absent; callers fall back to the
        built-in defaults).
      - ``approval_required``: bool — whether approval is required at all.
    """
    data = _load_config(hermes_home)
    section = data.get("security")
    if not isinstance(section, dict):
        return {"dangerous_commands": None, "approval_required": True}
    raw_patterns = section.get("dangerous_commands")
    patterns = (
        [str(p) for p in raw_patterns]
        if isinstance(raw_patterns, list)
        else None
    )
    approval_required = section.get("approval_required", True)
    if not isinstance(approval_required, bool):
        approval_required = True
    return {
        "dangerous_commands": patterns,
        "approval_required": approval_required,
    }

