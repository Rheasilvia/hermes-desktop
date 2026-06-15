from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class DelegationPauseRequest(BaseModel):
    paused: bool = True


class DelegationPauseResponse(BaseModel):
    paused: bool


class DelegationStatusResponse(BaseModel):
    active: list[dict[str, Any]]
    paused: bool
    max_spawn_depth: int
    max_concurrent_children: int


class SubagentInterruptResponse(BaseModel):
    found: bool
    subagent_id: str
