from __future__ import annotations

import logging
import sys

from fastapi import APIRouter, Request

from ..schemas.skills import SkillInfo, SkillsToolset, ToggleSkillRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/skills")
def list_skills(request: Request) -> dict:
    try:
        from tools.skills_tool import _find_all_skills
    except ImportError as exc:
        logger.exception(
            "Failed to import tools.skills_tool for /desktop/api/skills — "
            "sys.path=%r, cwd=%r",
            sys.path[:6],
            __import__("os").getcwd(),
        )
        return {
            "items": [],
            "error": "import_failed",
            "detail": f"tools.skills_tool not available: {exc}",
        }

    try:
        from hermes_cli.skills_config import get_disabled_skills
        from hermes_cli.config import load_config

        config = load_config()
        disabled = get_disabled_skills(config)
        # skip_disabled=True → return ALL skills so the UI can show
        # both enabled and disabled skills with a toggle (matches the
        # Electron desktop behaviour which hits the main gateway's
        # /api/skills endpoint).
        raw = _find_all_skills(skip_disabled=True)
        items = [
            SkillInfo(
                name=s["name"],
                description=s.get("description", ""),
                category=s.get("category") or "General",
                enabled=s["name"] not in disabled,
            )
            for s in raw
        ]
    except ImportError as exc:
        logger.exception(
            "Failed to import hermes_cli modules for /desktop/api/skills — "
            "sys.path=%r, cwd=%r",
            sys.path[:6],
            __import__("os").getcwd(),
        )
        return {
            "items": [],
            "error": "import_failed",
            "detail": f"hermes_cli modules not available: {exc}",
        }
    except Exception:
        logger.exception("Unexpected error listing skills")
        return {"items": [], "error": "internal_error"}

    return {"items": [i.model_dump() for i in items]}


@router.put("/skills/toggle")
def toggle_skill(request: Request, body: ToggleSkillRequest) -> dict:
    try:
        from hermes_cli.skills_config import get_disabled_skills, save_disabled_skills
        from hermes_cli.config import load_config

        config = load_config()
        disabled = get_disabled_skills(config)
        if body.enabled:
            disabled.discard(body.name)
        else:
            disabled.add(body.name)
        save_disabled_skills(config, disabled)
    except ImportError as exc:
        logger.exception(
            "Failed to import hermes_cli modules for /desktop/api/skills/toggle — "
            "sys.path=%r",
            sys.path[:6],
        )
        return {"ok": False, "name": body.name, "enabled": body.enabled, "error": str(exc)}
    except Exception:
        logger.exception("Unexpected error toggling skill %s", body.name)
        return {"ok": False, "name": body.name, "enabled": body.enabled, "error": "internal_error"}
    return {"ok": True, "name": body.name, "enabled": body.enabled}


@router.get("/toolsets")
def list_toolsets(request: Request) -> dict:
    try:
        from hermes_cli.tools_config import (
            _get_effective_configurable_toolsets,
            _get_platform_tools,
            _toolset_has_keys,
        )
    except ImportError as exc:
        logger.exception(
            "Failed to import hermes_cli.tools_config for /desktop/api/toolsets — "
            "sys.path=%r",
            sys.path[:6],
        )
        return {
            "items": [],
            "error": "import_failed",
            "detail": f"hermes_cli.tools_config not available: {exc}",
        }

    try:
        from toolsets import resolve_toolset
        from hermes_cli.config import load_config

        config = load_config()
        enabled = _get_platform_tools(config, "cli", include_default_mcp_servers=False)
        result = []
        for name, label, desc in _get_effective_configurable_toolsets():
            tools = sorted(set(resolve_toolset(name)))
            result.append(
                SkillsToolset(
                    name=name,
                    label=label,
                    description=desc,
                    enabled=name in enabled,
                    configured=_toolset_has_keys(name, config),
                    tools=tools,
                )
            )
    except ImportError as exc:
        logger.exception(
            "Failed to import toolsets for /desktop/api/toolsets — sys.path=%r",
            sys.path[:6],
        )
        return {
            "items": [],
            "error": "import_failed",
            "detail": f"toolsets module not available: {exc}",
        }
    except Exception:
        logger.exception("Unexpected error listing toolsets")
        return {"items": [], "error": "internal_error"}

    return {"items": [r.model_dump() for r in result]}
