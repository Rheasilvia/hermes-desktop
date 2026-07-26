from __future__ import annotations

from fastapi import APIRouter

from ..services.tools_service import ToolsService

router = APIRouter()


@router.get("/tools")
def list_tools() -> dict:
    items = ToolsService().list_tools()
    return {"items": [i.model_dump(exclude_none=True, by_alias=True) for i in items]}


@router.post("/tools/reload")
def reload_tools() -> dict:
    items = ToolsService().reload_tools()
    return {"items": [i.model_dump(exclude_none=True, by_alias=True) for i in items]}
