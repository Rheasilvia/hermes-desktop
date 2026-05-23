from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ProviderOverlay(BaseModel):
    visible: bool = True
    display_order: Optional[int] = None
    note: Optional[str] = None
    updated_at: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    api_key_env: Optional[str] = None
    api_key_set: bool = False
    api_key_preview: Optional[str] = None
    api_key_source: Optional[str] = None
    base_url_source: Optional[str] = None
    display_name: Optional[str] = None


class MergedProvider(BaseModel):
    id: str
    name: str
    auth: Optional[str] = None
    models: list[dict[str, Any]] = Field(default_factory=list)
    desktop: ProviderOverlay = Field(default_factory=ProviderOverlay)
    is_current: bool = False
    has_overlay: bool = False


# ── Request models for model router ────────────────────────────────────────


class SetActiveModelRequest(BaseModel):
    provider: str
    model: str


class UpsertProviderRequest(BaseModel):
    name: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    display_name: Optional[str] = None
    api_key_env: Optional[str] = None
    is_builtin: bool = False


class DeleteProviderRequest(BaseModel):
    name: str
    is_builtin: bool = False
