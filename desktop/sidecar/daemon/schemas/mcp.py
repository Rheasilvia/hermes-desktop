from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


McpTransport = Literal["stdio", "http", "streamable_http", "sse"]


class McpServerDesktop(BaseModel):
    pinned: bool = False
    note: Optional[str] = None
    display_order: Optional[int] = None
    last_selected_at: Optional[str] = None
    updated_at: Optional[str] = None


class PatchMcpServerDesktopRequest(BaseModel):
    pinned: Optional[bool] = None
    note: Optional[str] = None
    display_order: Optional[int] = None
    last_selected_at: Optional[str] = None


class McpServerConfig(BaseModel):
    name: str
    command: Optional[str] = None
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    url: Optional[str] = None
    headers: dict[str, str] = Field(default_factory=dict)
    timeout: Optional[int] = None
    connect_timeout: Optional[int] = None
    auth: Optional[str] = None
    oauth: Optional[dict[str, Any]] = None
    sampling: Optional[dict[str, Any]] = None
    transport: McpTransport = "stdio"
    enabled: bool = True


class McpServerCreate(McpServerConfig):
    name: str = Field(min_length=1, pattern=r"^[A-Za-z0-9_.-]+$")

    @model_validator(mode="after")
    def validate_transport_shape(self) -> "McpServerCreate":
        if self.transport == "stdio" and not self.command:
            raise ValueError("stdio MCP servers require command")
        if self.transport != "stdio" and not self.url:
            raise ValueError("HTTP MCP servers require url")
        return self


class McpServer(McpServerConfig):
    valid: bool = True
    error: Optional[str] = None
    status: Optional[dict[str, Any]] = None
    desktop: McpServerDesktop = Field(default_factory=McpServerDesktop)


class McpServerList(BaseModel):
    items: list[McpServer]
    generated_at: str


class McpReloadResponse(McpServerList):
    ok: bool = True
    refreshed_agents: int = 0


class McpTool(BaseModel):
    name: str
    description: Optional[str] = None
    inputSchema: Optional[dict[str, Any]] = None


class McpToolList(BaseModel):
    items: list[McpTool]
    status: Optional[dict[str, Any]] = None
