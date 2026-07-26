from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class DesktopSandboxSettings(BaseModel):
    mode: str = "workspace-write"
    network_access: str = "restricted"


class Settings(BaseModel):
    schema_version: int
    ui: dict[str, Any] = Field(default_factory=dict)
    desktop_sandbox: DesktopSandboxSettings = Field(default_factory=DesktopSandboxSettings)


class State(BaseModel):
    schema_version: int
    last_open_route: str = "/"
    window: dict[str, Any] = Field(default_factory=dict)
