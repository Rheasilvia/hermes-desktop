"""Sidecar runtime configuration. Loaded once at startup."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


class ConfigError(RuntimeError):
    """Configuration could not be loaded."""


@dataclass(frozen=True)
class Config:
    hermes_home: Path
    bind_host: str = "127.0.0.1"
    port: int = 18080
    token: Optional[str] = None


def _default_hermes_home() -> Path:
    env = os.environ.get("HERMES_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".hermes"


def load_config() -> Config:
    home = _default_hermes_home()
    port = int(os.environ.get("DESKTOP_BACKEND_PORT", "18080"))
    token = os.environ.get("DESKTOP_BACKEND_TOKEN") or None
    return Config(hermes_home=home, port=port, token=token)
