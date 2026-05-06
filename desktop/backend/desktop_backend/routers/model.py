# desktop/backend/desktop_backend/routers/model.py
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Query, Request

from ..overlays import loader as overlays_loader
from ..readers import model_catalog
from ..readers.auth_reader import read_auth_providers
from ..readers.hermes_config import read_active_model
from ..services.merger import filter_configured, merge_providers

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


def _load_models_dev_cache(hermes_home: Path) -> dict:
    cache_file = hermes_home / "models_dev_cache.json"
    if not cache_file.exists():
        return {}
    try:
        import json

        return json.loads(cache_file.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _get_provider_to_models_dev() -> dict[str, str]:
    """Return the Hermes→models.dev provider ID alias map from agent.models_dev.

    Returns an empty dict if agent is not installed — enrichment then falls back
    to direct cache lookup by the provider's own ID.
    """
    try:
        from agent.models_dev import PROVIDER_TO_MODELS_DEV

        return dict(PROVIDER_TO_MODELS_DEV)
    except ImportError:
        return {}


def _enrich_models(providers: list, hermes_home: Path) -> None:
    """Fill empty model lists from ~/.hermes/models_dev_cache.json.

    Reads the live cache directly (no package import needed) so that all model
    variants including highspeed are returned.  Filters to tool_call=True entries
    to match agent.models_dev.list_agentic_models() semantics.
    Falls back to hermes_cli.models.provider_model_ids() if cache has no entry.
    """
    cache = _load_models_dev_cache(hermes_home)
    alias_map = _get_provider_to_models_dev()

    def _ids_from_cache(pid: str) -> list[str]:
        cache_key = alias_map.get(pid, pid)
        provider_data = cache.get(cache_key, {})
        if not isinstance(provider_data, dict):
            return []
        models = provider_data.get("models", {})
        if not isinstance(models, dict):
            return []
        return [
            mid
            for mid, mdata in models.items()
            if isinstance(mdata, dict) and mdata.get("tool_call", False)
        ]

    for p in providers:
        if not p.models:
            ids = _ids_from_cache(p.id)
            p.models = [{"id": m, "name": m} for m in ids]


@router.get("/model/providers")
def list_providers(
    request: Request,
    configured_only: bool = Query(default=True),
):
    cfg = request.app.state.cfg
    providers = model_catalog.get_providers(cfg.hermes_home)
    overlay = overlays_loader.load(cfg.hermes_home, "model")
    merged = merge_providers(providers, overlay)
    catalog_ids = {p.id for p in merged}
    for ap in read_auth_providers(cfg.hermes_home):
        if ap.id not in catalog_ids:
            merged.append(ap)
    if configured_only:
        merged = filter_configured(merged)
    _enrich_models(merged, cfg.hermes_home)
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }
