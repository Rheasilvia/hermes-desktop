from __future__ import annotations

from fastapi import APIRouter, Depends

from ..schemas.commands import CommandRequest, SlashCompleteRequest
from ..services.dependencies import get_command_service

router = APIRouter()


@router.get("/commands/catalog")
def commands_catalog(svc=Depends(get_command_service)) -> dict:
    return svc.catalog()


@router.post("/commands/complete/slash")
def complete_slash(body: SlashCompleteRequest, svc=Depends(get_command_service)) -> dict:
    return {"items": [item.model_dump() for item in svc.complete_slash(body.partial)]}


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

