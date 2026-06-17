from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ToolInfo(BaseModel):
    name: str
    description: Optional[str] = None
    schema_: dict[str, Any] | None = Field(default=None, alias="schema")
    toolset: Optional[str] = None
