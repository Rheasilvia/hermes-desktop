from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..overlays import loader

router = APIRouter()

ALLOWED_DOMAINS = {"cron", "model"}


@router.patch("/overlays/{domain}/{entity_id}")
async def patch_overlay(domain: str, entity_id: str, request: Request):
    if domain not in ALLOWED_DOMAINS:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="VALIDATION")
    cfg = request.app.state.cfg
    return loader.update(cfg.hermes_home, domain, entity_id, body)
