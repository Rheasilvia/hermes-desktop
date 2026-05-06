from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def read_active_model(hermes_home: Path) -> dict[str, str | None]:
    config_path = Path(hermes_home) / "config.yaml"
    if not config_path.exists():
        return {"provider": None, "model": None}
    try:
        with open(config_path, "r", encoding="utf-8") as fh:
            data: Any = yaml.safe_load(fh)
    except yaml.YAMLError:
        return {"provider": None, "model": None}
    if not isinstance(data, dict):
        return {"provider": None, "model": None}
    section = data.get("model")
    if not isinstance(section, dict):
        return {"provider": None, "model": None}
    return {
        "provider": section.get("provider") or None,
        "model": section.get("default") or None,
    }
