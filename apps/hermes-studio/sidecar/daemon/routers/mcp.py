from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from ..schemas.mcp import McpReloadResponse, McpServerCreate, PatchMcpServerDesktopRequest
from ..services.dependencies import get_active_hermes_home, get_agent_pool
from ..services.mcp_service import McpService

router = APIRouter()


def _service(request: Request) -> McpService:
    return McpService(get_active_hermes_home(request))


@router.get("/mcp/servers")
def list_servers(request: Request) -> dict:
    items, generated_at = _service(request).list_servers()
    return {"items": [i.model_dump() for i in items], "generated_at": generated_at}


@router.post("/mcp/servers")
def add_server(body: McpServerCreate, request: Request) -> dict:
    return _service(request).add_server(body).model_dump()


@router.delete("/mcp/servers/{name}")
def remove_server(name: str, request: Request) -> dict:
    _service(request).remove_server(name)
    return {"ok": True}


@router.patch("/mcp/servers/{name}/desktop")
def patch_desktop(name: str, body: PatchMcpServerDesktopRequest, request: Request) -> dict:
    return _service(request).patch_desktop(name, body).model_dump()


@router.post("/mcp/reload")
def reload_mcp(request: Request, agent_pool=Depends(get_agent_pool)) -> dict:
    items, generated_at, refreshed_agents = _service(request).reload(agent_pool=agent_pool)
    return McpReloadResponse(
        items=items,
        generated_at=generated_at,
        refreshed_agents=refreshed_agents,
    ).model_dump()


@router.get("/mcp/servers/{name}/tools")
def list_tools(name: str, request: Request) -> dict:
    items, status = _service(request).list_tools(name)
    return {"items": [i.model_dump(exclude_none=True) for i in items], "status": status}
