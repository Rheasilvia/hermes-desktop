from __future__ import annotations

from fastapi import APIRouter, Depends

from .schemas import CommandRequest, PathCompleteRequest, SlashCompleteRequest
from daemon.services.dependencies import get_command_service
from daemon.services.dependencies import get_session_service
from daemon.services.path_completion import complete_path, completion_root

router = APIRouter()


@router.get("/commands/catalog")
def commands_catalog(svc=Depends(get_command_service)) -> dict:
    return svc.catalog()


@router.post("/commands/complete/slash")
def complete_slash(body: SlashCompleteRequest, svc=Depends(get_command_service)) -> dict:
    return {"items": [item.model_dump() for item in svc.complete_slash(body.partial)]}


@router.post("/commands/complete/path")
def complete_path_refs(
    body: PathCompleteRequest,
    session_svc=Depends(get_session_service),
) -> dict:
    session = session_svc.get_session(body.session_id) if body.session_id else None
    root = completion_root(cwd=body.cwd, fallback=(session or {}).get("cwd"))
    return {"items": complete_path(body.word, root=root)}


@router.post("/commands/slash/exec")
def slash_exec(body: CommandRequest, svc=Depends(get_command_service)) -> dict:
    return svc.exec(
        session_id=body.session_id,
        command=body.command,
        args=body.args,
        raw=body.raw,
    ).model_dump(exclude_none=True)


@router.post("/commands/dispatch")
def command_dispatch(body: CommandRequest, svc=Depends(get_command_service)) -> dict:
    return svc.exec(
        session_id=body.session_id,
        command=body.command,
        args=body.args,
        raw=body.raw,
    ).model_dump(exclude_none=True)
