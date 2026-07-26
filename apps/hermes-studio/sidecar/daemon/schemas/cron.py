from __future__ import annotations

from typing import Any, Optional

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
    name: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    skill: Optional[str] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    base_url: Optional[str] = None
    script: Optional[str] = None
    schedule_display: Optional[str] = None
    repeat: Optional[dict[str, Any]] = None
    state: Optional[str] = None
    paused_at: Optional[str] = None
    paused_reason: Optional[str] = None
    next_run_at: Optional[str] = None
    last_run_at: Optional[str] = None
    last_status: Optional[str] = None
    last_error: Optional[str] = None
    last_delivery_error: Optional[str] = None
    deliver: Optional[str] = None
    origin: Optional[dict[str, Any]] = None
    desktop: CronOverlay = Field(default_factory=CronOverlay)


class CreateCronJobRequest(BaseModel):
    prompt: str = Field(min_length=1)
    schedule: str = Field(min_length=1)
    name: Optional[str] = None
    repeat: Optional[int] = None
    deliver: Optional[str] = None
    origin: Optional[dict[str, Any]] = None
    skill: Optional[str] = None
    skills: Optional[list[str]] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    base_url: Optional[str] = None
    script: Optional[str] = None


class UpdateCronJobRequest(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    schedule: Optional[str] = None
    enabled: Optional[bool] = None
    repeat: Optional[int] = None
    deliver: Optional[str] = None
    skill: Optional[str] = None
    skills: Optional[list[str]] = None
    model: Optional[str] = None
    provider: Optional[str] = None
    base_url: Optional[str] = None
    script: Optional[str] = None
    paused_at: Optional[str] = None
    paused_reason: Optional[str] = None
