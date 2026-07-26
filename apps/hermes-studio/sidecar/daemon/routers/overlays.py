from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from ..overlays import loader
from ..services.dependencies import get_active_hermes_home

log = logging.getLogger(__name__)

router = APIRouter()

ALLOWED_DOMAINS = {"cron", "model"}


@contextmanager
def _hermes_home_env(hermes_home: Path):
    previous = os.environ.get("HERMES_HOME")
    os.environ["HERMES_HOME"] = str(hermes_home)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = previous


def _sync_model_overlay_to_env(hermes_home: Path, entity_id: str, body: dict) -> None:
    """When patching model overlay with api_key/base_url, also write to ~/.hermes/.env
    so TUI/CLI credential resolution can find the values."""
    try:
        from hermes_cli.config import save_env_value

        # Sync api_key to env vars
        if "api_key" in body and body["api_key"]:
            try:
                from .model import _provider_env_vars

                for env_var in _provider_env_vars(entity_id):
                    try:
                        with _hermes_home_env(hermes_home):
                            save_env_value(env_var, body["api_key"])
                    except Exception:
                        log.warning("overlay sync: failed to write %s to .env", env_var)
            except Exception:
                log.warning("overlay sync: failed to resolve env vars for %s", entity_id)

        # Sync base_url to env var
        if "base_url" in body and body["base_url"]:
            try:
                from hermes_cli.auth import PROVIDER_REGISTRY

                pconfig = PROVIDER_REGISTRY.get(entity_id)
                if pconfig and pconfig.base_url_env_var:
                    with _hermes_home_env(hermes_home):
                        save_env_value(pconfig.base_url_env_var, body["base_url"])
            except Exception:
                log.warning("overlay sync: failed to write base_url to .env for %s", entity_id)
    except Exception:
        log.warning("overlay sync: failed for %s", entity_id)


@router.patch("/overlays/{domain}/{entity_id}")
async def patch_overlay(domain: str, entity_id: str, request: Request):
    if domain not in ALLOWED_DOMAINS:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="VALIDATION")
    hermes_home = get_active_hermes_home(request)

    # Drop a base_url that is merely the provider registry default — persisting it
    # would defeat dynamic base_url resolution (e.g. sk-kimi- → api.kimi.com/coding)
    # and is the root cause of the kimi 401. Only genuine user overrides are kept.
    if domain == "model" and isinstance(body.get("base_url"), str):
        from ..services.model_service import is_provider_default_base_url
        if is_provider_default_base_url(entity_id, body["base_url"]):
            body.pop("base_url", None)
            body.pop("base_url_source", None)

    result = loader.update(hermes_home, domain, entity_id, body)

    # Sync model overlay changes to .env so all runtime paths see them
    if domain == "model":
        _sync_model_overlay_to_env(hermes_home, entity_id, body)

    return result
