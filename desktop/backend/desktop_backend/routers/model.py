# desktop/backend/desktop_backend/routers/model.py
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request

from ..overlays import loader as overlays_loader
from ..readers import model_catalog
from ..readers.hermes_config import read_active_model
from ..services.merger import merge_providers

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/model/active")
def get_active_model(request: Request):
    cfg = request.app.state.cfg
    return read_active_model(cfg.hermes_home)


@router.get("/model/catalog")
def get_catalog(request: Request):
    cfg = request.app.state.cfg
    catalog = model_catalog.load_catalog(cfg.hermes_home)
    return {
        "providers": catalog["providers"],
        "fetched_at": catalog.get("fetched_at"),
    }


@router.get("/model/providers")
def list_providers(
    request: Request,
    configured_only: bool = Query(default=False),
):
    cfg = request.app.state.cfg
    providers = model_catalog.get_providers(cfg.hermes_home)
    overlay = overlays_loader.load(cfg.hermes_home, "model")
    merged = merge_providers(providers, overlay)
    if configured_only:
        from ..services.merger import filter_configured
        merged = filter_configured(merged)
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }
