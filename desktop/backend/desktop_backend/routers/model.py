# desktop/backend/desktop_backend/routers/model.py
from __future__ import annotations

import ast
from contextlib import contextmanager
import json
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
from ..services.merger import filter_configured, merge_providers

router = APIRouter()

_REPO_ROOT = Path(__file__).resolve().parents[4]


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


# ---------------------------------------------------------------------------
# Model enrichment — mirrors the dashboard's list_authenticated_providers()
# logic using the same data sources (models_dev_cache.json, hermes_cli/models.py,
# agent/models_dev.py).
# ---------------------------------------------------------------------------

def _parse_dict_literal(py_file: Path, var_name: str) -> dict:
    """Extract a dict assignment from a Python source file via AST.

    Handles both ast.Assign and ast.AnnAssign. Skips entries whose values
    are function calls (e.g. _codex_curated_models()) instead of literals.
    """
    tree = ast.parse(py_file.read_text(encoding="utf-8"))
    for node in ast.iter_child_nodes(tree):
        value = None
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == var_name:
                    value = node.value
                    break
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id == var_name:
                value = node.value
        if value is None:
            continue
        if isinstance(value, ast.Dict):
            result: dict = {}
            for k, v in zip(value.keys, value.values):
                if isinstance(v, (ast.Call, ast.Name)):
                    continue
                try:
                    result[ast.literal_eval(k)] = ast.literal_eval(v)
                except Exception:
                    pass
            return result
        try:
            return ast.literal_eval(value)
        except Exception:
            return {}
    return {}


def _get_alias_map() -> dict[str, str]:
    """PROVIDER_TO_MODELS_DEV from agent/models_dev.py."""
    try:
        from agent.models_dev import PROVIDER_TO_MODELS_DEV
        return dict(PROVIDER_TO_MODELS_DEV)
    except ImportError:
        pass
    p = _REPO_ROOT / "agent" / "models_dev.py"
    return _parse_dict_literal(p, "PROVIDER_TO_MODELS_DEV") if p.exists() else {}


def _get_curated_models() -> dict[str, list[str]]:
    """_PROVIDER_MODELS from hermes_cli/models.py (curated model lists)."""
    try:
        from hermes_cli.models import _PROVIDER_MODELS
        return dict(_PROVIDER_MODELS)
    except ImportError:
        pass
    p = _REPO_ROOT / "hermes_cli" / "models.py"
    return _parse_dict_literal(p, "_PROVIDER_MODELS") if p.exists() else {}


def _load_models_dev_cache(hermes_home: Path) -> dict:
    cache_file = hermes_home / "models_dev_cache.json"
    if not cache_file.exists():
        return {}
    try:
        return json.loads(cache_file.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _cache_supplement_ids(
    cache: dict, alias_map: dict[str, str], pid: str, base_ids: list[str]
) -> list[str]:
    """Return extra model IDs from models_dev_cache that extend a curated base.

    Finds cache entries whose ID starts with one of the base IDs (e.g.
    MiniMax-M2.7-highspeed extends MiniMax-M2.7) but aren't already in the
    base list.  This mirrors the dashboard's _merge_with_models_dev logic.
    """
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


def _cache_tool_call_ids(cache: dict, alias_map: dict[str, str], pid: str) -> list[str]:
    """Return all tool_call model IDs from models_dev_cache for a provider."""
    cache_key = alias_map.get(pid, pid)
    provider_data = cache.get(cache_key, {})
    if not isinstance(provider_data, dict):
        return []
    models = provider_data.get("models", {})
    if not isinstance(models, dict):
        return []
    return sorted(
        mid
        for mid, mdata in models.items()
        if isinstance(mdata, dict) and mdata.get("tool_call", False)
    )


def _enrich_models(providers: list, hermes_home: Path) -> None:
    """Fill empty model lists using the same sources as the dashboard.

    Mirrors hermes_cli/model_switch.py list_authenticated_providers():
      1. hermes_cli.models.provider_model_ids() if available
      2. _PROVIDER_MODELS from hermes_cli/models.py as curated base
      3. models_dev_cache supplements with variants (e.g. highspeed)
      4. Full models_dev_cache tool_call ids as last resort
    """
    try:
        from hermes_cli.models import provider_model_ids
        has_cli = True
    except ImportError:
        has_cli = False

    curated = _get_curated_models() if not has_cli else {}
    cache = _load_models_dev_cache(hermes_home)
    alias_map = _get_alias_map()

    for p in providers:
        if p.models:
            continue
        if has_cli:
            ids = provider_model_ids(p.id)
        elif p.id in curated:
            base_ids = curated[p.id]
            extra = _cache_supplement_ids(cache, alias_map, p.id, base_ids)
            ids = base_ids + extra
        else:
            ids = _cache_tool_call_ids(cache, alias_map, p.id)
        p.models = [{"id": m, "name": m} for m in ids]


def _discover_env_providers(cache: dict, alias_map: dict[str, str]) -> dict[str, str]:
    """Return {provider_id: matched_env_var} for providers with env-based credentials.

    Mirrors the dashboard's list_authenticated_providers() logic:
    uses PROVIDER_REGISTRY (same source as dashboard) for env var names,
    falling back to models_dev_cache.json ``env`` field when not importable.
    """
    # Primary: use PROVIDER_REGISTRY (has the most accurate env var names)
    try:
        from hermes_cli.auth import PROVIDER_REGISTRY

        result: dict[str, str] = {}
        for slug, pc in PROVIDER_REGISTRY.items():
            if getattr(pc, "auth_type", "") != "api_key":
                continue
            for ev in getattr(pc, "api_key_env_vars", None) or []:
                if os.environ.get(ev, "").strip():
                    result[slug] = ev
                    break
        return result
    except ImportError:
        pass

    # Fallback: parse PROVIDER_REGISTRY from hermes_cli/auth.py via AST
    try:
        reg_file = _REPO_ROOT / "hermes_cli" / "auth.py"
        if reg_file.exists():
            found: dict[str, str] = {}
            tree = ast.parse(reg_file.read_text(encoding="utf-8"))
            for node in ast.iter_child_nodes(tree):
                if not (isinstance(node, ast.AnnAssign)
                        and isinstance(node.target, ast.Name)
                        and node.target.id == "PROVIDER_REGISTRY"):
                    continue
                if not isinstance(node.value, ast.Dict):
                    break
                for k, v in zip(node.value.keys, node.value.values):
                    if not isinstance(v, ast.Call):
                        continue
                    slug = ast.literal_eval(k)
                    for kw in v.keywords:
                        if kw.arg != "api_key_env_vars":
                            continue
                        try:
                            env_vars = ast.literal_eval(kw.value)
                        except Exception:
                            continue
                        for ev in env_vars:
                            if os.environ.get(ev, "").strip():
                                found[slug] = ev
                                break
                break
            return found
    except Exception:
        pass

    # Last resort: use models_dev_cache.json ``env`` field
    found2: dict[str, str] = {}
    for hermes_id, mdev_id in alias_map.items():
        pdata = cache.get(mdev_id, {})
        env_vars = pdata.get("env", []) if isinstance(pdata, dict) else []
        if not isinstance(env_vars, list):
            continue
        for ev in env_vars:
            if os.environ.get(ev, "").strip():
                found2[hermes_id] = ev
                break
    return found2


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
    cfg = request.app.state.cfg
    providers = model_catalog.get_providers(cfg.hermes_home)
    overlay = overlays_loader.load(cfg.hermes_home, "model")
    merged = merge_providers(providers, overlay)
    alias_map = _get_alias_map()

    # Merge auth.json credentials into existing catalog providers and add
    # any auth-only providers that aren't in the catalog at all.
    catalog_map = {p.id: p for p in merged}
    for ap in read_auth_providers(cfg.hermes_home):
        if ap.id in catalog_map:
            existing = catalog_map[ap.id]
            if not existing.desktop.api_key and ap.desktop.api_key:
                existing.desktop.api_key = ap.desktop.api_key
            if not existing.desktop.api_key_env and ap.desktop.api_key_env:
                existing.desktop.api_key_env = ap.desktop.api_key_env
            if not existing.desktop.base_url and ap.desktop.base_url:
                existing.desktop.base_url = ap.desktop.base_url
        else:
            merged.append(ap)
            catalog_map[ap.id] = ap

    # Discover providers with env-based credentials (same as dashboard).
    from ..schemas.model import MergedProvider, ProviderOverlay

    mdev_cache = _load_models_dev_cache(cfg.hermes_home)
    for slug, env_var in _discover_env_providers(mdev_cache, alias_map).items():
        if slug in catalog_map:
            if not catalog_map[slug].desktop.api_key_env:
                catalog_map[slug].desktop.api_key_env = env_var
        else:
            p = MergedProvider(
                id=slug,
                name=slug.replace("-", " ").replace("_", " ").title(),
                models=[],
                desktop=ProviderOverlay(api_key_env=env_var),
            )
            merged.append(p)
            catalog_map[slug] = p

    _enrich_models(merged, cfg.hermes_home)
    _apply_resolved_provider_credentials(merged, cfg.hermes_home)
    if configured_only:
        merged = filter_configured(merged)
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }


@router.post("/model/providers/{provider_id}/api-key/reveal")
def reveal_provider_api_key(provider_id: str, request: Request):
    cfg = request.app.state.cfg
    return _reveal_provider_api_key(provider_id, cfg.hermes_home)
