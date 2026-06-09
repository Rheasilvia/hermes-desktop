"""Desktop-owned plugin hub service.

Mirrors the dashboard hub logic from hermes_cli.web_server without importing
that module (to avoid server side-effects and dashboard coupling).
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

_dashboard_plugins_cache: Optional[list] = None


def _get_hermes_home() -> Path:
    from hermes_cli.config import get_hermes_home  # type: ignore[import]
    return get_hermes_home()


def _discover_dashboard_plugins() -> list:
    """Scan plugins/*/dashboard/manifest.json — mirrors web_server logic."""
    import json

    plugins: list = []
    seen_names: set = set()

    try:
        from hermes_cli.plugins import get_bundled_plugins_dir  # type: ignore[import]
        import os

        hermes_home = _get_hermes_home()
        bundled_root = get_bundled_plugins_dir()
        search_dirs = [
            (hermes_home / "plugins", "user"),
            (bundled_root / "memory", "bundled"),
            (bundled_root, "bundled"),
        ]
        if os.environ.get("HERMES_ENABLE_PROJECT_PLUGINS"):
            search_dirs.append((Path.cwd() / ".hermes" / "plugins", "project"))

        for plugins_root, source in search_dirs:
            if not plugins_root.is_dir():
                continue
            for child in sorted(plugins_root.iterdir()):
                if not child.is_dir():
                    continue
                manifest_file = child / "dashboard" / "manifest.json"
                if not manifest_file.exists():
                    continue
                try:
                    data = json.loads(manifest_file.read_text(encoding="utf-8"))
                    name = data.get("name", child.name)
                    if name in seen_names:
                        continue
                    seen_names.add(name)
                    raw_tab = data.get("tab", {}) if isinstance(data.get("tab"), dict) else {}
                    tab_info: Dict[str, Any] = {
                        "path": raw_tab.get("path", f"/{name}"),
                        "position": raw_tab.get("position", "end"),
                    }
                    override_path = raw_tab.get("override")
                    if isinstance(override_path, str) and override_path.startswith("/"):
                        tab_info["override"] = override_path
                    if bool(raw_tab.get("hidden")):
                        tab_info["hidden"] = True
                    slots_src = data.get("slots")
                    slots: List[str] = []
                    if isinstance(slots_src, list):
                        slots = [s for s in slots_src if isinstance(s, str) and s]
                    plugins.append({
                        "name": name,
                        "label": data.get("label", name),
                        "description": data.get("description", ""),
                        "icon": data.get("icon", "Puzzle"),
                        "version": data.get("version", "0.0.0"),
                        "tab": tab_info,
                        "slots": slots,
                        "entry": data.get("entry", "dist/index.js"),
                        "css": data.get("css"),
                        "has_api": bool(data.get("api")),
                        "source": source,
                        "_dir": str(child / "dashboard"),
                        "_api_file": data.get("api"),
                    })
                except Exception as exc:
                    log.warning("Bad dashboard plugin manifest %s: %s", manifest_file, exc)
    except ImportError:
        pass

    return plugins


def _get_dashboard_plugins(force_rescan: bool = False) -> list:
    global _dashboard_plugins_cache
    if _dashboard_plugins_cache is None or force_rescan:
        _dashboard_plugins_cache = _discover_dashboard_plugins()
    return _dashboard_plugins_cache


def _strip_internal(p: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in p.items() if not k.startswith("_")}


def validate_plugin_name(name: str) -> str:
    if not name or "/" in name or "\\" in name or ".." in name:
        raise ValueError("Invalid plugin name.")
    return name


def _cfg_get(cfg: dict, *keys: str, default: Any = None) -> Any:
    cur: Any = cfg
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k, default)
    return cur


def get_plugins_hub(force_rescan: bool = False) -> dict:
    try:
        from hermes_cli.plugins_cmd import (  # type: ignore[import]
            _discover_all_plugins,
            _get_current_context_engine,
            _get_current_memory_provider,
            _discover_context_engines,
            _discover_memory_providers,
            _get_disabled_set,
            _get_enabled_set,
            _read_manifest as _read_plugin_manifest_at,
        )
        from hermes_cli.config import load_config  # type: ignore[import]
    except ImportError as exc:
        log.warning("hermes_cli not available: %s", exc)
        return {
            "plugins": [],
            "orphan_dashboard_plugins": [],
            "providers": {
                "memory_provider": "",
                "memory_options": [],
                "context_engine": None,
                "context_options": [],
            },
        }

    dashboard_list = _get_dashboard_plugins(force_rescan=force_rescan)
    dash_by_name = {str(p["name"]): p for p in dashboard_list}

    disabled_set = _get_disabled_set()
    enabled_set = _get_enabled_set()

    config = load_config()
    hidden_plugins: list = _cfg_get(config, "dashboard", "hidden_plugins", default=[]) or []

    hermes_home = _get_hermes_home()
    plugins_root_resolved = (hermes_home / "plugins").resolve()
    rows: List[Dict[str, Any]] = []

    for name, version, description, source, dir_str, key in _discover_all_plugins():
        aliases = {name}
        if key:
            aliases.add(key)
        if aliases & disabled_set:
            runtime_status = "disabled"
        elif aliases & enabled_set:
            runtime_status = "enabled"
        else:
            runtime_status = "inactive"

        dir_path = Path(dir_str)
        dm = dash_by_name.get(name)
        has_dash_manifest = dm is not None or (dir_path / "dashboard" / "manifest.json").exists()

        under_user_tree = False
        try:
            dir_path.resolve().relative_to(plugins_root_resolved)
            under_user_tree = True
        except ValueError:
            pass

        can_remove_update = (
            source in ("user", "git") and under_user_tree and Path(dir_str).is_dir()
        )

        auth_required = False
        auth_command = ""
        manifest_data = _read_plugin_manifest_at(dir_path)
        provides_tools = manifest_data.get("provides_tools") or []
        if provides_tools:
            try:
                from tools.registry import registry  # type: ignore[import]
                for tname in provides_tools:
                    entry = registry.get_entry(tname)
                    if entry and entry.check_fn and not entry.check_fn():
                        auth_required = True
                        auth_command = f"hermes auth {name}"
                        break
            except Exception:
                pass

        rows.append({
            "name": name,
            "version": version or "",
            "description": description or "",
            "source": source,
            "runtime_status": runtime_status,
            "has_dashboard_manifest": has_dash_manifest,
            "dashboard_manifest": _strip_internal(dm) if dm else None,
            "path": dir_str,
            "can_remove": can_remove_update,
            "can_update_git": can_remove_update and (Path(dir_str) / ".git").exists(),
            "auth_required": auth_required,
            "auth_command": auth_command,
            "user_hidden": name in hidden_plugins,
        })

    agent_names = {r["name"] for r in rows}
    orphan_dashboard = [
        _strip_internal(p) for p in dashboard_list if str(p["name"]) not in agent_names
    ]

    memory_providers: List[Dict[str, str]] = []
    try:
        for n, desc in _discover_memory_providers():
            memory_providers.append({"name": n, "description": desc})
    except Exception:
        memory_providers = []

    context_engines: List[Dict[str, str]] = []
    try:
        for n, desc in _discover_context_engines():
            context_engines.append({"name": n, "description": desc})
    except Exception:
        context_engines = []

    return {
        "plugins": rows,
        "orphan_dashboard_plugins": orphan_dashboard,
        "providers": {
            "memory_provider": _get_current_memory_provider() or "",
            "memory_options": memory_providers,
            "context_engine": _get_current_context_engine(),
            "context_options": context_engines,
        },
    }


def rescan_plugins() -> dict:
    hub = get_plugins_hub(force_rescan=True)
    return {"ok": True, "count": len(hub.get("plugins", []))}


def install_plugin(identifier: str, force: bool, enable: bool) -> dict:
    try:
        from hermes_cli.plugins_cmd import dashboard_install_plugin  # type: ignore[import]
    except ImportError:
        return {"ok": False, "error": "hermes_cli not available."}
    result = dashboard_install_plugin(identifier.strip(), force=force, enable=enable)
    if result.get("ok"):
        _get_dashboard_plugins(force_rescan=True)
        result.pop("after_install_path", None)
    return result


def set_plugin_enabled(name: str, enabled: bool) -> dict:
    try:
        from hermes_cli.plugins_cmd import dashboard_set_agent_plugin_enabled  # type: ignore[import]
    except ImportError:
        return {"ok": False, "error": "hermes_cli not available."}
    return dashboard_set_agent_plugin_enabled(name, enabled=enabled)


def update_plugin(name: str) -> dict:
    try:
        from hermes_cli.plugins_cmd import dashboard_update_user_plugin  # type: ignore[import]
    except ImportError:
        return {"ok": False, "error": "hermes_cli not available."}
    result = dashboard_update_user_plugin(name)
    if result.get("ok"):
        _get_dashboard_plugins(force_rescan=True)
    return result


def remove_plugin(name: str) -> dict:
    try:
        from hermes_cli.plugins_cmd import dashboard_remove_user_plugin  # type: ignore[import]
    except ImportError:
        return {"ok": False, "error": "hermes_cli not available."}
    result = dashboard_remove_user_plugin(name)
    if result.get("ok"):
        _get_dashboard_plugins(force_rescan=True)
    return result


def save_plugin_providers(
    memory_provider: Optional[str], context_engine: Optional[str]
) -> dict:
    try:
        from hermes_cli.plugins_cmd import (  # type: ignore[import]
            _save_context_engine,
            _save_memory_provider,
        )
    except ImportError:
        return {"ok": False, "error": "hermes_cli not available."}
    if memory_provider is not None:
        _save_memory_provider(memory_provider)
    if context_engine is not None:
        _save_context_engine(context_engine)
    return {"ok": True}


def set_plugin_visibility(name: str, hidden: bool) -> dict:
    try:
        from hermes_cli.config import load_config, save_config  # type: ignore[import]
    except ImportError:
        return {"ok": False, "error": "hermes_cli not available."}

    config = load_config()
    if "dashboard" not in config or not isinstance(config.get("dashboard"), dict):
        config["dashboard"] = {}
    hidden_list: list = config["dashboard"].get("hidden_plugins") or []
    if not isinstance(hidden_list, list):
        hidden_list = []

    if hidden and name not in hidden_list:
        hidden_list.append(name)
    elif not hidden and name in hidden_list:
        hidden_list.remove(name)

    config["dashboard"]["hidden_plugins"] = hidden_list
    save_config(config)
    return {"ok": True, "name": name, "hidden": hidden}
