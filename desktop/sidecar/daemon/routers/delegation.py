from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas.delegation import (
    DelegationPauseRequest,
    DelegationPauseResponse,
    DelegationStatusResponse,
    SubagentInterruptResponse,
)

router = APIRouter()


@router.get("/delegation/status", response_model=DelegationStatusResponse)
def delegation_status() -> DelegationStatusResponse:
    from tools.delegate_tool import (
        _get_max_concurrent_children,
        _get_max_spawn_depth,
        is_spawn_paused,
        list_active_subagents,
    )

    return DelegationStatusResponse(
        active=list_active_subagents(),
        paused=is_spawn_paused(),
        max_spawn_depth=_get_max_spawn_depth(),
        max_concurrent_children=_get_max_concurrent_children(),
    )


@router.post("/delegation/pause", response_model=DelegationPauseResponse)
def delegation_pause(body: DelegationPauseRequest) -> DelegationPauseResponse:
    from tools.delegate_tool import set_spawn_paused

    return DelegationPauseResponse(paused=set_spawn_paused(body.paused))


@router.post("/subagents/{subagent_id}/interrupt", response_model=SubagentInterruptResponse)
def subagent_interrupt(subagent_id: str) -> SubagentInterruptResponse:
    clean_id = subagent_id.strip()
    if not clean_id:
        raise HTTPException(status_code=400, detail="SUBAGENT_ID_REQUIRED")

    from tools.delegate_tool import interrupt_subagent

    return SubagentInterruptResponse(
        found=interrupt_subagent(clean_id),
        subagent_id=clean_id,
    )
