from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class ConfigReadResponse(BaseModel):
    config: dict[str, Any]
    mtime: float


class ConfigSaveRequest(BaseModel):
    config: dict[str, Any]
    base_mtime: Optional[float] = None
    changed_paths: Optional[list[str]] = None


class ConfigSaveResponse(BaseModel):
    ok: bool
    mtime: float

