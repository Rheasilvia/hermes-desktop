from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ..schemas.workspace import RevealWorkspacePathRequest
from ..services.dependencies import get_workspace_service
from ..services.workspace_service import WorkspaceServiceError

router = APIRouter()


@router.get("/sessions/{session_id}/workspace/children")
def list_workspace_children(
    session_id: str,
    path: str = Query("."),
    svc=Depends(get_workspace_service),
) -> dict:
    try:
        return svc.list_children(session_id, path).model_dump()
    except WorkspaceServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/sessions/{session_id}/workspace/file")
def read_workspace_file(
    session_id: str,
    path: str,
    svc=Depends(get_workspace_service),
) -> dict:
    try:
        return svc.read_file(session_id, path).model_dump()
    except WorkspaceServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/workspace/reveal")
def reveal_workspace_path(
    session_id: str,
    body: RevealWorkspacePathRequest,
    svc=Depends(get_workspace_service),
) -> dict:
    try:
        return svc.reveal(session_id, body.path)
    except WorkspaceServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
