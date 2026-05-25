"""ModelService — provider CRUD, env sync, API key resolution, and catalog merging.

Extracted from routers/model.py inline logic.
"""

from __future__ import annotations

from contextlib import contextmanager
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from .exceptions import ProviderNotFoundError

log = logging.getLogger(__name__)

_SIBLING_PROVIDERS = (
    ("kimi-coding", "kimi-coding-cn"),
)


def _redact_secret(value: str) -> str:
    try:
        from hermes_cli.config import redact_key
        return str(redact_key(value))
    except Exception:
        if len(value) <= 8:
            return "********"
        return f"{value[:4]}********{value[-4:]}"


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


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _provider_env_vars(provider_id: str) -> list[str]:
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


class ModelService:
    """Provider CRUD, env sync, API key resolution, and catalog merging."""

    def __init__(self, hermes_home: Path) -> None:
        self._hermes_home = hermes_home

    def get_active_model(self) -> dict:
        from ..readers.hermes_config import read_active_model
        return read_active_model(self._hermes_home)

    def set_active_model(self, provider: str, model: str) -> None:
        config_path = self._hermes_home / "config.yaml"
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
            model_section["provider"] = provider
            model_section["default"] = model
            model_section["base_url"] = ""
            model_section.pop("context_length", None)
            data["model"] = model_section
            with open(config_path, "w", encoding="utf-8") as fh:
                yaml.dump(data, fh, default_flow_style=False, allow_unicode=True)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

    def get_catalog(self) -> dict:
        from ..readers import model_catalog
        catalog = model_catalog.load_catalog(self._hermes_home)
        return {
            "providers": catalog["providers"],
            "fetched_at": catalog.get("fetched_at"),
        }

    def list_providers(self, configured_only: bool = True) -> dict:
        from hermes_cli.inventory import build_models_payload, load_picker_context
        from ..overlays import loader as overlays_loader
        from ..services.merger import filter_configured

        ctx = load_picker_context()
        payload = build_models_payload(
            ctx, include_unconfigured=True, picker_hints=True, canonical_order=True,
        )
        overlay = overlays_loader.load(self._hermes_home, "model")
        merged = self._map_payload_to_merged(payload["providers"], overlay)
        self._apply_resolved_credentials(merged)
        if configured_only:
            merged = filter_configured(merged)
        return {"items": [m.model_dump() for m in merged], "generated_at": _now_iso()}

    def upsert_provider(self, body: Any) -> dict:
        from ..overlays import loader as overlays_loader

        patch: dict[str, Any] = {}
        if body.api_key is not None:
            patch["api_key"] = body.api_key
            patch["api_key_source"] = "desktop"
            for env_var in _provider_env_vars(body.name):
                try:
                    from hermes_cli.config import save_env_value
                    with _hermes_home_env(self._hermes_home):
                        save_env_value(env_var, body.api_key)
                except Exception:
                    log.warning("Failed to write %s to .env", env_var)
        if body.base_url is not None:
            patch["base_url"] = body.base_url
            patch["base_url_source"] = "desktop"
            try:
                from hermes_cli.auth import PROVIDER_REGISTRY
                pconfig = PROVIDER_REGISTRY.get(body.name)
                if pconfig and pconfig.base_url_env_var:
                    from hermes_cli.config import save_env_value
                    with _hermes_home_env(self._hermes_home):
                        save_env_value(pconfig.base_url_env_var, body.base_url)
            except Exception:
                log.warning("Failed to write base_url to .env for %s", body.name)
        if body.display_name is not None:
            patch["display_name"] = body.display_name
        if body.api_key_env is not None:
            patch["api_key_env"] = body.api_key_env

        entry = overlays_loader.update(self._hermes_home, "model", body.name, patch)
        return {"name": body.name, **entry}

    def delete_provider(self, provider_id: str) -> None:
        from ..overlays import loader as overlays_loader
        try:
            overlays_loader.delete(self._hermes_home, "model", provider_id)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

    def reveal_api_key(self, provider_id: str) -> dict:
        from ..overlays import loader as overlays_loader
        from ..readers.auth_reader import read_auth_providers

        overlay = overlays_loader.load(self._hermes_home, "model")
        raw = str(overlay.get(provider_id, {}).get("api_key") or "").strip()
        if raw:
            return {"provider": provider_id, "api_key": raw, "source": "desktop"}

        for ap in read_auth_providers(self._hermes_home):
            if ap.id == provider_id and ap.desktop.api_key:
                return {"provider": provider_id, "api_key": ap.desktop.api_key,
                        "source": ap.desktop.api_key_source or "credential_pool"}

        try:
            from hermes_cli.auth import resolve_api_key_provider_credentials
            with _hermes_home_env(self._hermes_home):
                creds = resolve_api_key_provider_credentials(provider_id)
            key = str(creds.get("api_key") or "").strip()
            if key:
                return {"provider": provider_id, "api_key": key,
                        "source": str(creds.get("source") or "")}
        except Exception:
            pass

        raise ProviderNotFoundError()

    def _map_payload_to_merged(self, rows: list[dict], overlay: dict) -> list:
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
                    api_key_env=entry.get("api_key_env"),
                    api_key_set=bool(row.get("authenticated")),
                    visible=entry.get("visible", True),
                ),
            )
            merged.append(p)
        return merged

    def _apply_resolved_credentials(self, providers: list) -> None:
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
                    with _hermes_home_env(self._hermes_home):
                        creds = resolve_api_key_provider_credentials(provider.id)
                    resolved_key = str(creds.get("api_key") or "").strip()
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
                except Exception:
                    pass

            desktop.api_key = None
