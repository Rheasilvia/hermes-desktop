from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class PluginDashboardManifest(BaseModel):
    name: str
    label: str = ""
    description: str = ""
    icon: str = "Puzzle"
    version: str = "0.0.0"
    tab: dict[str, Any] = {}
    slots: list[str] = []
    entry: str = "dist/index.js"
    css: Optional[str] = None
    has_api: bool = False
    source: str = ""


class PluginRow(BaseModel):
    name: str
    version: str
    description: str
    source: str
    runtime_status: str
    has_dashboard_manifest: bool
    dashboard_manifest: Optional[dict[str, Any]] = None
    path: str
    can_remove: bool
    can_update_git: bool
    auth_required: bool
    auth_command: str
    user_hidden: bool


class PluginProviderOption(BaseModel):
    name: str
    description: str


class PluginProviders(BaseModel):
    memory_provider: str
    memory_options: list[PluginProviderOption]
    context_engine: Optional[str]
    context_options: list[PluginProviderOption]


class PluginsHubResponse(BaseModel):
    plugins: list[PluginRow]
    orphan_dashboard_plugins: list[dict[str, Any]]
    providers: PluginProviders


class PluginInstallRequest(BaseModel):
    identifier: str
    force: bool = False
    enable: bool = True


class PluginProvidersRequest(BaseModel):
    memory_provider: Optional[str] = None
    context_engine: Optional[str] = None


class PluginVisibilityRequest(BaseModel):
    hidden: bool
