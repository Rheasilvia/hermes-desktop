# desktop/backend/desktop_backend/routers/model.py
from __future__ import annotations

from contextlib import contextmanager
import logging
import os
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
from ..services.merger import filter_configured

log = logging.getLogger(__name__)

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class SetActiveModelRequest(BaseModel):
    provider: str
    model: str


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


def _redact_secret(value: str) -> str:
    try:
        from hermes_cli.config import redact_key

        return str(redact_key(value))
    except Exception:
        if len(value) <= 8:
            return "********"
        return f"{value[:4]}********{value[-4:]}"


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


def _map_payload_to_merged(rows: list[dict], overlay: dict[str, dict]) -> list:
    """Map build_models_payload() provider rows to MergedProvider list.

    Merges desktop overlay data (user-saved display_name, api_key, base_url)
    on top of the dynamically discovered provider list from the TUI data source.
    """
    from ..schemas.model import MergedProvider, ProviderOverlay

    merged: list = []
    for row in rows:
        slug = row.get("slug", "")
        entry = overlay.get(slug, {})
        p = MergedProvider(
            id=slug,
            name=entry.get("display_name") or row.get("name", slug),
            auth=row.get("auth_type"),
            models=[{"id": m, "name": m} for m in row.get("models", [])],
            is_current=bool(row.get("is_current")),
            has_overlay=bool(entry),
            desktop=ProviderOverlay(
                display_name=entry.get("display_name"),
                base_url=entry.get("base_url"),
                api_key=entry.get("api_key"),
                api_key_env=entry.get("api_key_env") or row.get("key_env"),
                api_key_set=bool(row.get("authenticated")),
                visible=entry.get("visible", True),
            ),
        )
        merged.append(p)
    return merged


def _apply_resolved_provider_credentials(providers: list, hermes_home: Path) -> None:
    """Attach dashboard-style key/base-url metadata without exposing raw secrets.

    The dashboard Keys page shows env-backed LLM provider credentials via
    OPTIONAL_ENV_VARS and reveals the raw value only on demand.  The desktop
    model list follows the same shape: configured state, redacted preview, and
    source are returned up front; raw API keys are stripped from the list
    payload so they are not cached by the frontend.
    """
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY, resolve_api_key_provider_credentials
    except Exception:
        PROVIDER_REGISTRY = {}
        resolve_api_key_provider_credentials = None

    for provider in providers:
        desktop = provider.desktop

        raw_key = (desktop.api_key or "").strip()
        if raw_key:
            desktop.api_key_set = True
            desktop.api_key_preview = _redact_secret(raw_key)
            desktop.api_key_source = desktop.api_key_source or "desktop"

        pconfig = PROVIDER_REGISTRY.get(provider.id) if PROVIDER_REGISTRY else None
        if pconfig is not None:
            if not desktop.api_key_env:
                for env_name in getattr(pconfig, "api_key_env_vars", ()) or ():
                    if os.environ.get(env_name, "").strip():
                        desktop.api_key_env = env_name
                        break
            if not desktop.base_url:
                default_base_url = (
                    getattr(pconfig, "inference_base_url", "")
                    or getattr(pconfig, "base_url", "")
                )
                if default_base_url:
                    desktop.base_url = str(default_base_url).rstrip("/")
                    desktop.base_url_source = "provider-default"

        if resolve_api_key_provider_credentials is not None and pconfig is not None:
            try:
                with _hermes_home_env(hermes_home):
                    creds = resolve_api_key_provider_credentials(provider.id)
                resolved_key = str(creds.get("api_key") or "").strip()
                resolved_base_url = str(creds.get("base_url") or "").strip()
                resolved_source = str(creds.get("source") or "").strip()
                if resolved_key:
                    desktop.api_key_set = True
                    desktop.api_key_preview = _redact_secret(resolved_key)
                    desktop.api_key_source = resolved_source or desktop.api_key_source
                    if resolved_source and not desktop.api_key_env:
                        for prefix in ("env:", ""):
                            source = resolved_source.removeprefix(prefix)
                            if source.endswith("_API_KEY") or source.endswith("_TOKEN"):
                                desktop.api_key_env = source
                                break
                if resolved_base_url:
                    desktop.base_url = resolved_base_url.rstrip("/")
                    desktop.base_url_source = "resolved"
            except Exception:
                pass

        # Never leak raw secrets in the providers list; reveal uses a dedicated endpoint.
        desktop.api_key = None


def _reveal_provider_api_key(provider_id: str, hermes_home: Path) -> dict[str, str]:
    overlay = overlays_loader.load(hermes_home, "model")
    raw_overlay_key = str(overlay.get(provider_id, {}).get("api_key") or "").strip()
    if raw_overlay_key:
        return {"provider": provider_id, "api_key": raw_overlay_key, "source": "desktop"}

    for auth_provider in read_auth_providers(hermes_home):
        if auth_provider.id == provider_id and auth_provider.desktop.api_key:
            return {
                "provider": provider_id,
                "api_key": auth_provider.desktop.api_key,
                "source": auth_provider.desktop.api_key_source or "credential_pool",
            }

    try:
        from hermes_cli.auth import resolve_api_key_provider_credentials

        with _hermes_home_env(hermes_home):
            creds = resolve_api_key_provider_credentials(provider_id)
        api_key = str(creds.get("api_key") or "").strip()
        if api_key:
            return {
                "provider": provider_id,
                "api_key": api_key,
                "source": str(creds.get("source") or ""),
            }
    except Exception:
        pass

    raise HTTPException(status_code=404, detail="NOT_FOUND")


@router.get("/model/providers")
def list_providers(
    request: Request,
    configured_only: bool = Query(default=True),
):
    """Return the full provider catalog, using the same dynamic data source as TUI /model."""
    cfg = request.app.state.cfg

    from hermes_cli.inventory import build_models_payload, load_picker_context

    ctx = load_picker_context()
    # Always include unconfigured providers so overlay data (saved base_url,
    # api_key_env, display_name) reaches filter_configured.  Otherwise a
    # provider just added via the Add Provider catalog won't appear in the
    # configured list until the user sets a real API key.
    payload = build_models_payload(
        ctx,
        include_unconfigured=True,
        picker_hints=True,
        canonical_order=True,
    )

    overlay = overlays_loader.load(cfg.hermes_home, "model")
    merged = _map_payload_to_merged(payload["providers"], overlay)
    _apply_resolved_provider_credentials(merged, cfg.hermes_home)

    if configured_only:
        merged = filter_configured(merged)
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }


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
        # Also write base_url to .env so TUI/CLI can see the endpoint.
        try:
            from hermes_cli.auth import PROVIDER_REGISTRY

            pconfig = PROVIDER_REGISTRY.get(body.name)
            if pconfig and pconfig.base_url_env_var:
                from hermes_cli.config import save_env_value

                with _hermes_home_env(cfg.hermes_home):
                    save_env_value(pconfig.base_url_env_var, body.base_url)
        except Exception:
            log.warning("Failed to write base_url to .env for %s", body.name)
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
        overlays_loader.delete(cfg.hermes_home, "model", provider_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/model/providers/{provider_id}/api-key/reveal")
def reveal_provider_api_key(provider_id: str, request: Request):
    cfg = request.app.state.cfg
    return _reveal_provider_api_key(provider_id, cfg.hermes_home)
