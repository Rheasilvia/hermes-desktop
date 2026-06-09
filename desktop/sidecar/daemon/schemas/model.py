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


# ── Auxiliary model assignment ──────────────────────────────────────────────


class AuxTaskEntry(BaseModel):
    task: str
    provider: str
    model: str
    base_url: str = ""


class AuxMainEntry(BaseModel):
    provider: str
    model: str


class AuxiliaryModelsResponse(BaseModel):
    tasks: list[AuxTaskEntry]
    main: AuxMainEntry


class StaleAuxEntry(BaseModel):
    task: str
    provider: str
    model: str


class ModelAssignmentRequest(BaseModel):
    scope: str  # "main" | "auxiliary"
    provider: str = ""
    model: str = ""
    task: str = ""  # auxiliary slot; "" = all slots; "__reset__" = reset all
    base_url: str = ""


class ModelAssignmentResponse(BaseModel):
    ok: bool
    scope: str
    provider: Optional[str] = None
    model: Optional[str] = None
    stale_aux: list[StaleAuxEntry] = Field(default_factory=list)
    reset: Optional[bool] = None
    tasks: Optional[list[str]] = None
    gateway_tools: list[str] = Field(default_factory=list)
