# desktop/backend/desktop_backend/routers/model.py
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

import yaml

from ..overlays import loader as overlays_loader
from ..readers import model_catalog
from ..readers.auth_reader import read_auth_providers
from ..readers.hermes_config import read_active_model
from ..services.merger import filter_configured, merge_providers

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class SetActiveModelRequest(BaseModel):
    provider: str
    model: str


@router.get("/model/active")
def get_active_model(request: Request):
    cfg = request.app.state.cfg
    return read_active_model(cfg.hermes_home)


@router.put("/model/active")
def set_active_model(request: Request, body: SetActiveModelRequest):
    """Write provider + model to ~/.hermes/config.yaml model section."""
    cfg = request.app.state.cfg
    config_path = cfg.hermes_home / "config.yaml"
    try:
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as fh:
                data: Any = yaml.safe_load(fh) or {}
        else:
            data = {}
        if not isinstance(data, dict):
            data = {}
        model_section = data.get("model", {})
        if not isinstance(model_section, dict):
            model_section = {}
        model_section["provider"] = body.provider
        model_section["default"] = body.model
        # Clear stale overrides that belong to the previous model (mirrors dashboard logic)
        model_section["base_url"] = ""
        model_section.pop("context_length", None)
        data["model"] = model_section
        with open(config_path, "w", encoding="utf-8") as fh:
            yaml.dump(data, fh, default_flow_style=False, allow_unicode=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"provider": body.provider, "model": body.model}


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
    """Fill empty model lists using hermes_cli as primary source, cache for supplements.

    hermes_cli.models.provider_model_ids() is the authoritative source of hermes-
    compatible model IDs (same as the dashboard).  models_dev_cache supplements with
    variants (e.g. highspeed) whose IDs extend a hermes base ID as a prefix —
    catching MiniMax-M2.7-highspeed without importing incompatible models.dev IDs
    like k2p6 that conflict with the hermes kimi-k2.6 namespace.
    """
    cache = _load_models_dev_cache(hermes_home)
    alias_map = _get_provider_to_models_dev()

    def _cache_extra_ids(pid: str, base_ids: list[str]) -> list[str]:
        cache_key = alias_map.get(pid, pid)
        provider_data = cache.get(cache_key, {})
        if not isinstance(provider_data, dict):
            return []
        models = provider_data.get("models", {})
        if not isinstance(models, dict):
            return []
        base_set = set(base_ids)
        return [
            mid
            for mid, mdata in models.items()
            if isinstance(mdata, dict)
            and mdata.get("tool_call", False)
            and mid not in base_set
            and any(mid.startswith(b) for b in base_ids)
        ]

    for p in providers:
        if not p.models:
            try:
                from hermes_cli.models import provider_model_ids

                base_ids = provider_model_ids(p.id)
            except ImportError:
                base_ids = []
            extra_ids = _cache_extra_ids(p.id, base_ids)
            p.models = [{"id": m, "name": m} for m in base_ids + extra_ids]


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
