from __future__ import annotations

from typing import List

from pydantic import BaseModel


class SkillInfo(BaseModel):
    name: str
    description: str
    category: str
    enabled: bool


class SkillsResponse(BaseModel):
    items: List[SkillInfo]


class ToggleSkillRequest(BaseModel):
    name: str
    enabled: bool


class SkillsToolset(BaseModel):
    name: str
    label: str
    description: str
    enabled: bool
    configured: bool
    tools: List[str]


class ToolsetsResponse(BaseModel):
    items: List[SkillsToolset]
