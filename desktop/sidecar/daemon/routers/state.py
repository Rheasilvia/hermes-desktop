from __future__ import annotations

from fastapi import APIRouter, Request

from ..store import state as store

router = APIRouter()


@router.get("/state")
def get_state(request: Request):
    cfg = request.app.state.cfg
    return store.load(cfg.hermes_home)


@router.put("/state")
async def put_state(request: Request):
    cfg = request.app.state.cfg
    payload = await request.json()
    return store.save(cfg.hermes_home, payload)
