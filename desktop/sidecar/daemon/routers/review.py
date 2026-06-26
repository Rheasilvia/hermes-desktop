from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..schemas.review import (
    ReviewCommitMessageRequest,
    ReviewCommitRequest,
    ReviewDiffRequest,
    ReviewPathsRequest,
)
from ..services.dependencies import get_review_service
from ..services.git_service import GitServiceError

router = APIRouter()


@router.get("/sessions/{session_id}/review/files")
def review_files(session_id: str, svc=Depends(get_review_service)) -> dict:
    try:
        return svc.files(session_id).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/review/diff")
def review_diff(
    session_id: str,
    body: ReviewDiffRequest,
    svc=Depends(get_review_service),
) -> dict:
    try:
        return svc.diff(session_id, path=body.path, staged=body.staged).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/review/stage")
def review_stage(
    session_id: str,
    body: ReviewPathsRequest,
    svc=Depends(get_review_service),
) -> dict:
    try:
        return svc.stage(session_id, body.paths).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/review/unstage")
def review_unstage(
    session_id: str,
    body: ReviewPathsRequest,
    svc=Depends(get_review_service),
) -> dict:
    try:
        return svc.unstage(session_id, body.paths).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/review/revert")
def review_revert(
    session_id: str,
    body: ReviewPathsRequest,
    svc=Depends(get_review_service),
) -> dict:
    try:
        return svc.revert(session_id, body.paths).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/review/commit")
def review_commit(
    session_id: str,
    body: ReviewCommitRequest,
    svc=Depends(get_review_service),
) -> dict:
    try:
        return svc.commit(session_id, body.message).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/review/push")
def review_push(session_id: str, svc=Depends(get_review_service)) -> dict:
    try:
        return svc.push(session_id).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/review/pr")
def review_pr(session_id: str, svc=Depends(get_review_service)) -> dict:
    try:
        return svc.create_pr(session_id).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.post("/sessions/{session_id}/review/commit-message")
def review_commit_message(
    session_id: str,
    body: ReviewCommitMessageRequest,
    svc=Depends(get_review_service),
) -> dict:
    try:
        return svc.commit_message(session_id, avoid=body.avoid).model_dump()
    except GitServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
