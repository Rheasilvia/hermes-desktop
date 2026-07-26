from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ..schemas.projects import (
    ActiveProjectRequest,
    BranchSwitchRequest,
    ProjectUpsertRequest,
    WorktreeAddRequest,
    WorktreeRemoveRequest,
)
from ..services.dependencies import get_project_service
from ..services.git_service import GitServiceError

router = APIRouter()


@router.get("/projects")
def list_projects(svc=Depends(get_project_service)) -> dict:
    return svc.list_projects().model_dump()


@router.post("/projects")
def upsert_project(body: ProjectUpsertRequest, svc=Depends(get_project_service)) -> dict:
    try:
        return svc.upsert_project(body.path, body.name).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.put("/projects/active")
def set_active_project(body: ActiveProjectRequest, svc=Depends(get_project_service)) -> dict:
    try:
        return svc.set_active_project(body.path).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/projects/worktrees")
def list_worktrees(
    repo_path: str = Query(...),
    svc=Depends(get_project_service),
) -> dict:
    try:
        return svc.list_worktrees(repo_path).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/projects/worktrees/add")
def add_worktree(body: WorktreeAddRequest, svc=Depends(get_project_service)) -> dict:
    try:
        return svc.add_worktree(body.repo_path, body.path, body.branch, body.create_branch).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/projects/worktrees/remove")
def remove_worktree(body: WorktreeRemoveRequest, svc=Depends(get_project_service)) -> dict:
    try:
        return svc.remove_worktree(body.repo_path, body.path).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/projects/branches")
def list_branches(repo_path: str = Query(...), svc=Depends(get_project_service)) -> dict:
    try:
        return svc.branches(repo_path).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/projects/branches/switch")
def switch_branch(body: BranchSwitchRequest, svc=Depends(get_project_service)) -> dict:
    try:
        return svc.switch_branch(body.path, body.branch).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
