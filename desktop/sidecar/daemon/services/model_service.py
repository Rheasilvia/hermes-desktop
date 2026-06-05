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


def provider_registry_base_url(provider_id: str) -> str:
    """The provider registry's default base_url for a provider (alias-aware), or ''."""
    try:
        from hermes_cli.auth import resolve_provider, PROVIDER_REGISTRY
        try:
            canonical = resolve_provider(provider_id)
        except Exception:
            canonical = provider_id
        pcfg = PROVIDER_REGISTRY.get(canonical) or PROVIDER_REGISTRY.get(provider_id)
        if pcfg is not None:
            return str(
                getattr(pcfg, "inference_base_url", "") or getattr(pcfg, "base_url", "") or ""
            ).strip().rstrip("/")
    except Exception:
        pass
    return ""


def is_provider_default_base_url(provider_id: str, base_url: str | None) -> bool:
    """True if base_url is just the provider registry default (NOT a genuine user override).

    Persisting/syncing the default defeats the CLI's dynamic base_url resolution
    (e.g. sk-kimi- keys must route to api.kimi.com/coding), so callers should skip
    writing base_url when this returns True.
    """
    if not base_url:
        return False
    default = provider_registry_base_url(provider_id)
    return bool(default) and base_url.strip().rstrip("/") == default


class ModelService:
    """Provider CRUD, env sync, API key resolution, and catalog merging."""

    def __init__(self, hermes_home: Path, event_bus: Any = None) -> None:
        self._hermes_home = hermes_home
        self._bus = event_bus

    def get_active_model(self) -> dict:
        from ..readers.hermes_config import read_active_model
        return read_active_model(self._hermes_home)

    def set_active_model(self, provider: str, model: str) -> None:
        """Write provider + default model to config.yaml.

        base_url and context_length are PROVIDER-specific, so they are cleared
        when the provider changes (otherwise the previous provider's base_url
        leaks — e.g. minimax-cn left pointing at a codex endpoint). When the
        provider is unchanged (only the model changed), they are preserved so a
        user's custom base_url / context_length survives.
        """
        # Validate before writing
        self._validate_provider_model(provider, model)

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
            provider_changed = model_section.get("provider") != provider
            model_section["provider"] = provider
            model_section["default"] = model
            if provider_changed:
                # Drop provider-specific fields so they don't leak across providers.
                model_section.pop("base_url", None)
                model_section.pop("context_length", None)
            data["model"] = model_section
            with open(config_path, "w", encoding="utf-8") as fh:
                yaml.dump(data, fh, default_flow_style=False, allow_unicode=True)
        except Exception as exc:
            raise RuntimeError(str(exc)) from exc

        # Notify all connected frontends that the default model changed
        if self._bus is not None:
            try:
                self._bus.publish("", 0, "model.changed", {
                    "provider": provider,
                    "model": model,
                })
            except Exception:
                log.debug("Failed to publish model.changed event")

    def _validate_provider_model(self, provider: str, model: str) -> None:
        """Raise ValueError if provider or model are empty/blank strings."""
        if not provider or not provider.strip():
            raise ValueError("provider must not be empty")
        if not model or not model.strip():
            raise ValueError("model must not be empty")

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
        # Only persist/sync base_url when it's a GENUINE user override. Writing the
        # provider registry default would defeat dynamic base_url resolution (e.g.
        # sk-kimi- → api.kimi.com/coding) and is the root cause of the kimi 401.
        if body.base_url is not None and not is_provider_default_base_url(body.name, body.base_url):
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

    def get_models_config(self, provider_id: str) -> dict:
        """Return the per-model config blob stored in the provider overlay."""
        from ..overlays import loader as overlays_loader
        import json
        overlay = overlays_loader.load(self._hermes_home, "model")
        raw = overlay.get(provider_id, {}).get("models_config")
        if not raw:
            return {"models_config": None}
        try:
            return {"models_config": raw}
        except Exception:
            return {"models_config": None}

    def set_model_params(self, provider_id: str, model_id: str, params: dict) -> None:
        """Persist per-model params (temperature, max_tokens, capabilities) in overlay."""
        from ..overlays import loader as overlays_loader
        import json
        overlay = overlays_loader.load(self._hermes_home, "model")
        raw = overlay.get(provider_id, {}).get("models_config")
        current: dict = {}
        if raw:
            try:
                current = json.loads(raw)
            except Exception:
                pass
        current[model_id] = {**current.get(model_id, {}), **params}
        overlays_loader.update(
            self._hermes_home, "model", provider_id,
            {"models_config": json.dumps(current)},
        )

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
        import json
        merged: list = []
        for row in rows:
            slug = row.get("slug", "")
            entry = overlay.get(slug, {})
            # Parse per-model config blob to apply enabled/param overrides
            models_config: dict = {}
            raw_mc = entry.get("models_config")
            if raw_mc:
                try:
                    models_config = json.loads(raw_mc)
                except Exception:
                    pass
            raw_auth = row.get("auth_type")
            # Normalize: oauth_device_code, oauth_minimax, oauth_external → oauth
            if raw_auth and str(raw_auth).startswith("oauth"):
                raw_auth = "oauth"
            # Cross-reference OAuth catalog for providers whose auth_type
            # is None in build_models_payload but are defined as OAuth providers.
            if not raw_auth or raw_auth == "api_key":
                try:
                    from ..services.oauth_service import _OAUTH_PROVIDER_CATALOG
                    _oauth_ids = {e["id"] for e in _OAUTH_PROVIDER_CATALOG}
                    if slug in _oauth_ids:
                        raw_auth = "oauth"
                except Exception:
                    pass
            # Build model list with enabled + param overrides from models_config
            model_list = []
            for m in row.get("models", []):
                mc = models_config.get(m, {})
                model_entry: dict = {"id": m, "name": m}
                # enabled defaults to True unless overlay says otherwise
                model_entry["enabled"] = mc.get("enabled", True)
                # Persist any param overrides so the frontend can display them
                for param in ("default_temperature", "default_max_tokens",
                              "supports_vision", "supports_function_calling", "supports_streaming"):
                    if param in mc:
                        model_entry[param] = mc[param]
                model_list.append(model_entry)

            p = MergedProvider(
                id=slug,
                name=entry.get("display_name") or row.get("name", slug),
                auth=raw_auth,
                models=model_list,
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
