from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..store import state as store
from ..store.settings import SchemaVersionMismatch

router = APIRouter()


@router.get("/state")
def get_state(request: Request):
    cfg = request.app.state.cfg
    return store.load(cfg.hermes_home)


@router.put("/state")
async def put_state(request: Request):
    cfg = request.app.state.cfg
    payload = await request.json()
    try:
        return store.save(cfg.hermes_home, payload)
    except SchemaVersionMismatch:
        raise HTTPException(status_code=409, detail="SCHEMA_VERSION")
