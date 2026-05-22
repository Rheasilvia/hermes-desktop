"""Model endpoints — active model, catalog, provider CRUD, API key reveal.

All business logic is delegated to ModelService injected via FastAPI Depends().
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..schemas.model import SetActiveModelRequest, UpsertProviderRequest
from ..services.dependencies import get_model_service
from ..services.exceptions import ProviderNotFoundError

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/model/active")
def get_active_model(svc=Depends(get_model_service)):
    return svc.get_active_model()


@router.put("/model/active")
def set_active_model(body: SetActiveModelRequest, svc=Depends(get_model_service)):
    try:
        svc.set_active_model(body.provider, body.model)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"provider": body.provider, "model": body.model}


@router.get("/model/catalog")
def get_catalog(svc=Depends(get_model_service)):
    return svc.get_catalog()


@router.get("/model/providers")
def list_providers(
    configured_only: bool = Query(default=True),
    svc=Depends(get_model_service),
):
    return svc.list_providers(configured_only=configured_only)


@router.post("/model/providers")
def upsert_provider(body: UpsertProviderRequest, svc=Depends(get_model_service)):
    return svc.upsert_provider(body)


@router.delete("/model/providers/{provider_id}")
def delete_provider(provider_id: str, svc=Depends(get_model_service)):
    try:
        svc.delete_provider(provider_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True}


class UpsertProviderRequest(BaseModel):
    name: str
    api_key: str | None = None
    base_url: str | None = None
    display_name: str | None = None
    api_key_env: str | None = None
    is_builtin: bool = False


class DeleteProviderRequest(BaseModel):
    name: str
    is_builtin: bool = False


# Providers that share the same API key — when saving one, write to all siblings'
# env vars so the TUI/CLI finds the key regardless of which variant is active.
_SIBLING_PROVIDERS = (
    ("kimi-coding", "kimi-coding-cn"),
)


def _provider_env_vars(provider_id: str) -> list[str]:
    """Return ALL API-key env var names for a provider AND its siblings.

    e.g., saving kimi-coding-cn also writes to KIMI_API_KEY (kimi-coding's
    primary env var), so the key is found no matter which variant the TUI uses.
    """
    ids_to_check = {provider_id}
    for group in _SIBLING_PROVIDERS:
        if provider_id in group:
            ids_to_check.update(group)

    env_vars: list[str] = []
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY

        for pid in ids_to_check:
            pconfig = PROVIDER_REGISTRY.get(pid)
            if pconfig and pconfig.api_key_env_vars:
                env_vars.extend(pconfig.api_key_env_vars)
    except Exception:
        pass
    return env_vars


@router.post("/model/providers")
def upsert_provider(body: UpsertProviderRequest, request: Request):
    """Write provider API key / base_url into the model overlay AND .env."""
    cfg = request.app.state.cfg
    patch: dict[str, Any] = {}
    if body.api_key is not None:
        patch["api_key"] = body.api_key
        patch["api_key_source"] = "desktop"
        # Also write to .env so TUI/CLI can see the key.
        # Write to ALL env var variants (e.g., KIMI_API_KEY + KIMI_CODING_API_KEY)
        # so the key is visible regardless of which provider variant is active.
        for env_var in _provider_env_vars(body.name):
            try:
                from hermes_cli.config import save_env_value

                with _hermes_home_env(cfg.hermes_home):
                    save_env_value(env_var, body.api_key)
            except Exception:
                log.warning("Failed to write %s to .env", env_var)
    if body.base_url is not None:
        patch["base_url"] = body.base_url
        patch["base_url_source"] = "desktop"
    if body.display_name is not None:
        patch["display_name"] = body.display_name
    if body.api_key_env is not None:
        patch["api_key_env"] = body.api_key_env
    if not patch:
        raise HTTPException(status_code=400, detail="No fields to update")
    entry = overlays_loader.update(cfg.hermes_home, "model", body.name, patch)
    return {"name": body.name, **entry}


@router.delete("/model/providers/{provider_id}")
def delete_provider(provider_id: str, request: Request):
    """Remove a provider entry from the model overlay."""
    cfg = request.app.state.cfg
    try:
        overlays_loader.update(cfg.hermes_home, "model", provider_id, {"api_key": "", "base_url": ""})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/model/providers/{provider_id}/api-key/reveal")
def reveal_provider_api_key(provider_id: str, svc=Depends(get_model_service)):
    try:
        return svc.reveal_api_key(provider_id)
    except ProviderNotFoundError:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
