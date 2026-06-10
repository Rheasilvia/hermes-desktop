from __future__ import annotations
import json
import logging
from typing import Any

log = logging.getLogger(__name__)

_INSTALLED = False
ORIGINAL_TOOLS: dict[str, Any] = {}  # name -> ToolEntry


def install_desktop_tool_overrides() -> None:
    """Idempotent. Call once from build_app() before model/agent prewarm."""
    global _INSTALLED
    if _INSTALLED:
        return

    import tools.registry as _registry_module
    from tools.registry import registry
    import model_tools

    # Step 1: discover and import all built-in tool modules so they are registered
    _registry_module.discover_builtin_tools()

    # Step 2: capture originals BEFORE any override
    _TOOL_NAMES = ["read_file", "write_file", "patch", "search_files",
                   "terminal", "process", "execute_code"]
    for name in _TOOL_NAMES:
        entry = registry.get_entry(name)
        if entry is not None:
            ORIGINAL_TOOLS[name] = entry

    # Step 3: register same-name wrappers with override=True
    _install_wrappers(registry)

    # Step 4: clear model tool definition caches
    model_tools._clear_tool_defs_cache()

    _INSTALLED = True


def _install_wrappers(registry) -> None:
    """Register desktop-policy wrappers for each tool. Called only once."""
    from ..services.workspace_policy import get_workspace_policy_snapshot

    def _fail_closed(tool_name: str, args: dict) -> str:
        return json.dumps({"error": f"desktop policy: no workspace snapshot active for {tool_name}", "code": "POLICY_MISSING"})

    # Helper: build wrapper that calls original handler with policy check
    def _make_wrapper(name: str):
        original_entry = ORIGINAL_TOOLS.get(name)
        if original_entry is None:
            return None  # tool not registered; skip

        def wrapper(args, **kwargs) -> str:
            snapshot = get_workspace_policy_snapshot()
            if snapshot is None:
                return _fail_closed(name, args)
            # Specific enforcement per tool is added in Tasks 4-7.
            # For now, just pass through to original (skeleton).
            return original_entry.handler(args, **kwargs)

        return wrapper

    for name in list(ORIGINAL_TOOLS.keys()):
        wrapper = _make_wrapper(name)
        if wrapper is None:
            continue
        original = ORIGINAL_TOOLS[name]
        registry.register(
            name=name,
            toolset=original.toolset,
            schema=original.schema,
            handler=wrapper,
            check_fn=original.check_fn,
            requires_env=original.requires_env,
            is_async=original.is_async,
            description=original.description,
            emoji=original.emoji,
            max_result_size_chars=original.max_result_size_chars,
            dynamic_schema_overrides=original.dynamic_schema_overrides,
            override=True,
        )
        log.info("[desktop] installed policy wrapper for tool: %s", name)
