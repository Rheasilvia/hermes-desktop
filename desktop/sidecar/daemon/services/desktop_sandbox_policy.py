from __future__ import annotations

import logging
from pathlib import Path

from ..store.settings import load as load_desktop_settings
from ..store.settings import normalize_desktop_sandbox

log = logging.getLogger(__name__)


def load_desktop_sandbox_policy(hermes_home: Path, *, context: str = "") -> dict[str, str]:
    """Load desktop-local sandbox policy with conservative defaults on failure."""
    try:
        desktop_settings = load_desktop_settings(hermes_home)
        return normalize_desktop_sandbox(desktop_settings.get("desktop_sandbox"))
    except Exception as exc:
        suffix = f" for {context}" if context else ""
        log.warning(
            "[desktop] sandbox settings read failed%s; using defaults: %s",
            suffix,
            exc,
        )
        return normalize_desktop_sandbox(None)
