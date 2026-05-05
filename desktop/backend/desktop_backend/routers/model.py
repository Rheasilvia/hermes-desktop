from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request

from ..overlays import loader as overlays_loader
from ..readers import model_catalog
from ..services.merger import merge_providers

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/model/catalog")
def get_catalog(request: Request):
    cfg = request.app.state.cfg
    catalog = model_catalog.load_catalog(cfg.hermes_home)
    return {
        "providers": catalog["providers"],
        "fetched_at": catalog.get("fetched_at"),
    }


@router.get("/model/providers")
def list_providers(request: Request):
    cfg = request.app.state.cfg
    providers = model_catalog.get_providers(cfg.hermes_home)
    overlay = overlays_loader.load(cfg.hermes_home, "model")
    merged = merge_providers(providers, overlay)
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }
