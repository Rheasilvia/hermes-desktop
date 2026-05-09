from __future__ import annotations

from fastapi import APIRouter, Request

from ..schemas.skills import SkillInfo, SkillsToolset, ToggleSkillRequest

router = APIRouter()


@router.get("/skills")
def list_skills(request: Request) -> dict:
    try:
        from tools.skills_tool import _find_all_skills
        from hermes_cli.skills_config import get_disabled_skills
        from hermes_cli.config import load_config

        config = load_config()
        disabled = get_disabled_skills(config)
        raw = _find_all_skills(skip_disabled=False)
        items = [
            SkillInfo(
                name=s["name"],
                description=s.get("description", ""),
                category=s.get("category") or "General",
                enabled=s["name"] not in disabled,
            )
            for s in raw
        ]
    except ImportError:
        items = []
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
    except ImportError:
        pass
    return {"ok": True, "name": body.name, "enabled": body.enabled}


@router.get("/toolsets")
def list_toolsets(request: Request) -> dict:
    try:
        from hermes_cli.tools_config import (
            _get_effective_configurable_toolsets,
            _get_platform_tools,
            _toolset_has_keys,
        )
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
    except ImportError:
        result = []
    return {"items": [r.model_dump() for r in result]}
