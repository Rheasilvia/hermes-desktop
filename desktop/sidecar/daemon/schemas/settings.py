from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Settings(BaseModel):
    schema_version: int
    ui: dict[str, Any] = Field(default_factory=dict)


class State(BaseModel):
    schema_version: int
    last_open_route: str = "/"
    window: dict[str, Any] = Field(default_factory=dict)
