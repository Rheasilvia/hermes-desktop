"""HTTP API for the Memory Manager.

All paths sit under ``/desktop/api/memory/*``. Path safety, file I/O, and
search go through ``services.memory_files``; this module only handles
HTTP-layer concerns: request shaping, dataclass → Pydantic conversion,
and the ``If-Match`` header for optimistic concurrency on writes.
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, Header, Query, Request, Response

from ..schemas.memory import (
    MemoryFileInfo,
    MemoryFileListResponse,
    MemoryFileWithContent,
    MemoryProject,
    MemoryProjectListResponse,
    MemorySearchHit,
    MemorySearchResponse,
    SearchRequest,
    WriteFileRequest,
)
from ..services.dependencies import get_active_hermes_home
from ..services import memory_files as svc

router = APIRouter(prefix="/memory", tags=["memory"])


# ── Conversion helpers ──────────────────────────────────────────────────


def _info_to_model(info: svc.MemoryFileInfo) -> MemoryFileInfo:
    return MemoryFileInfo(**asdict(info))


def _content_to_model(payload: svc.MemoryFileWithContent) -> MemoryFileWithContent:
    return MemoryFileWithContent(**asdict(payload.info), content=payload.content)


def _hit_to_model(hit: svc.MemorySearchHit) -> MemorySearchHit:
    return MemorySearchHit(
        info=_info_to_model(hit.info),
        line_number=hit.line_number,
        snippet=hit.snippet,
        match_count=hit.match_count,
    )


def _project_to_model(p: svc.MemoryProject) -> MemoryProject:
    return MemoryProject(**asdict(p))


# ── Endpoints ───────────────────────────────────────────────────────────


@router.get("/projects", response_model=MemoryProjectListResponse)
async def list_projects(request: Request) -> MemoryProjectListResponse:
    hermes_home = get_active_hermes_home(request)
    projects = svc.list_projects(hermes_home)
    return MemoryProjectListResponse(projects=[_project_to_model(p) for p in projects])


@router.get("/files", response_model=MemoryFileListResponse)
async def list_files(
    request: Request,
    scope: str = Query(..., pattern="^(user|project)$"),
    workspace: Optional[str] = Query(default=None),
) -> MemoryFileListResponse:
    hermes_home = get_active_hermes_home(request)
    known = svc.list_known_workspaces(hermes_home)
    files = svc.list_files(
        scope,  # type: ignore[arg-type]
        workspace,
        hermes_home=hermes_home,
        known_workspaces=known,
    )
    return MemoryFileListResponse(files=[_info_to_model(f) for f in files])


@router.get("/file", response_model=MemoryFileWithContent)
async def read_file(
    request: Request,
    scope: str = Query(..., pattern="^(user|project)$"),
    name: str = Query(...),
    workspace: Optional[str] = Query(default=None),
) -> MemoryFileWithContent:
    hermes_home = get_active_hermes_home(request)
    known = svc.list_known_workspaces(hermes_home)
    payload = svc.read_file(
        scope,  # type: ignore[arg-type]
        workspace,
        name,
        hermes_home=hermes_home,
        known_workspaces=known,
    )
    return _content_to_model(payload)


@router.put("/file", response_model=MemoryFileWithContent)
async def write_file(
    request: Request,
    body: WriteFileRequest,
    response: Response,
    if_match: Optional[str] = Header(default=None, alias="If-Match"),
) -> MemoryFileWithContent:
    hermes_home = get_active_hermes_home(request)
    known = svc.list_known_workspaces(hermes_home)
    payload = svc.write_file(
        body.scope,
        body.workspace,
        body.name,
        body.content,
        if_match,
        hermes_home=hermes_home,
        known_workspaces=known,
    )
    if payload.info.modified_at:
        response.headers["ETag"] = payload.info.modified_at
    return _content_to_model(payload)


@router.post("/search", response_model=MemorySearchResponse)
async def search(
    request: Request,
    body: SearchRequest,
) -> MemorySearchResponse:
    hermes_home = get_active_hermes_home(request)
    known = svc.list_known_workspaces(hermes_home)
    hits = svc.search(
        body.query,
        body.scope,
        body.workspace,
        hermes_home=hermes_home,
        known_workspaces=known,
    )
    return MemorySearchResponse(hits=[_hit_to_model(h) for h in hits])
