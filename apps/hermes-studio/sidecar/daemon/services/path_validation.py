"""Path validation helpers for desktop cwd-scoped operations."""

from __future__ import annotations

from pathlib import Path


def resolve_existing_cwd(cwd: str | None) -> Path:
    raw = str(cwd or "").strip()
    if not raw:
        raise ValueError("cwd required")
    path = Path(raw).expanduser().resolve()
    if not path.exists() or not path.is_dir():
        raise ValueError(f"working directory does not exist: {raw}")
    return path


def resolve_under_cwd(path: str | Path, cwd: str | Path) -> Path:
    root = resolve_existing_cwd(str(cwd))
    raw = str(path or "").strip()
    if not raw:
        raise ValueError("path required")
    resolved = Path(raw).expanduser()
    if not resolved.is_absolute():
        resolved = root / resolved
    resolved = resolved.resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise ValueError(f"path is outside cwd: {raw}") from exc
    return resolved


__all__ = ["resolve_existing_cwd", "resolve_under_cwd"]
