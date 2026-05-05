"""Sidecar runtime configuration. Loaded once at startup."""
from __future__ import annotations

import os
import stat
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


class ConfigError(RuntimeError):
    """Configuration could not be loaded."""


@dataclass(frozen=True)
class Config:
    hermes_home: Path
    token_file: Path
    bind_host: str = "127.0.0.1"
    token: Optional[str] = None


def _default_hermes_home() -> Path:
    env = os.environ.get("HERMES_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".hermes"


def _read_token(token_file: Path) -> str:
    if not token_file.exists():
        raise ConfigError(f"Token file missing: {token_file}")
    st = token_file.stat()
    mode = stat.S_IMODE(st.st_mode)
    if mode & 0o077:
        raise ConfigError(
            f"Token file {token_file} must be 0600; got {oct(mode)}"
        )
    token = token_file.read_text(encoding="utf-8").strip()
    if not token:
        raise ConfigError(f"Token file {token_file} is empty")
    return token


def load_config(*, require_token: bool) -> Config:
    home = _default_hermes_home()
    token_file = home / "desktop" / "sidecar.token"
    token = _read_token(token_file) if require_token else None
    return Config(hermes_home=home, token_file=token_file, token=token)
