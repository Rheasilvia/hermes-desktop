from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..store import settings as store
from ..store.settings import RuntimeConfigKeyError, SchemaVersionMismatch

router = APIRouter()


@router.get("/settings")
def get_settings(request: Request):
    cfg = request.app.state.cfg
    return store.load(cfg.hermes_home)


@router.put("/settings")
async def put_settings(request: Request):
    cfg = request.app.state.cfg
    payload = await request.json()
    try:
        return store.save(cfg.hermes_home, payload)
    except RuntimeConfigKeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except SchemaVersionMismatch:
        raise HTTPException(status_code=409, detail="SCHEMA_VERSION")
