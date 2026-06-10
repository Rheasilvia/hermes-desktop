from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..schemas.git import GitCheckoutRequest
from ..services.dependencies import get_git_service
from ..services.git_service import GitServiceError

router = APIRouter()


@router.get("/sessions/{session_id}/git/diff")
def run_git_diff(session_id: str, svc=Depends(get_git_service)) -> dict:
    try:
        return svc.diff(session_id).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/sessions/{session_id}/git/branches")
def get_git_branches(session_id: str, svc=Depends(get_git_service)) -> dict:
    try:
        return svc.branches(session_id).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/git/checkout")
def checkout_git_branch(
    session_id: str,
    body: GitCheckoutRequest,
    svc=Depends(get_git_service),
) -> dict:
    try:
        return svc.checkout(session_id, body.branch)
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
