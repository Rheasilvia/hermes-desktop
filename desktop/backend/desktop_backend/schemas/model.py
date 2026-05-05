from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ProviderOverlay(BaseModel):
    visible: bool = True
    display_order: Optional[int] = None
    note: Optional[str] = None
    updated_at: Optional[str] = None


class MergedProvider(BaseModel):
    id: str
    name: str
    auth: Optional[str] = None
    models: list[dict[str, Any]] = Field(default_factory=list)
    desktop: ProviderOverlay = Field(default_factory=ProviderOverlay)
