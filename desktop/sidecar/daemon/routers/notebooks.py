from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ..schemas.notebook import NotebookWatchRequest, NotebookWatchResult
from ..services.dependencies import get_notebook_service, get_notebook_watch_service
from ..services.notebook_service import NotebookService, NotebookServiceError
from ..services.notebook_watch_service import NotebookWatchService
from ..services.workspace_service import WorkspaceServiceError

router = APIRouter()


@router.get("/sessions/{session_id}/notebook/render")
def render_notebook(
    session_id: str,
    path: str = Query(...),
    svc: NotebookService = Depends(get_notebook_service),
) -> dict:
    try:
        return svc.render_notebook(session_id, path).model_dump()
    except (NotebookServiceError, WorkspaceServiceError) as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/notebook/watch")
def watch_notebook(
    session_id: str,
    body: NotebookWatchRequest,
    svc: NotebookWatchService = Depends(get_notebook_watch_service),
) -> dict:
    try:
        path = svc.watch(session_id, body.path)
        return NotebookWatchResult(ok=True, path=path).model_dump()
    except WorkspaceServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.delete("/sessions/{session_id}/notebook/watch")
def clear_notebook_watch(
    session_id: str,
    svc: NotebookWatchService = Depends(get_notebook_watch_service),
) -> dict:
    svc.clear(session_id)
    return NotebookWatchResult(ok=True).model_dump()
