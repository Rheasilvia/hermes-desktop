from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CronOverlay(BaseModel):
    pinned: bool = False
    color: Optional[str] = None
    note: Optional[str] = None
    updated_at: Optional[str] = None


class MergedCronJob(BaseModel):
    id: str
    schedule: str
    prompt: str
    enabled: bool
    created_at: str
    last_run_at: Optional[str] = None
    last_status: Optional[str] = None
    last_error: Optional[str] = None
    desktop: CronOverlay = Field(default_factory=CronOverlay)
