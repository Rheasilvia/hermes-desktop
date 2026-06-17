from __future__ import annotations

from ..schemas.tools import ToolInfo
from .exceptions import ToolsUnavailableError


class ToolsService:
    def list_tools(self) -> list[ToolInfo]:
        try:
            from model_tools import discover_builtin_tools
            from tools.registry import registry

            discover_builtin_tools()
            rows = []
            for name in registry.get_all_tool_names():
                schema = registry.get_schema(name) or {}
                rows.append(
                    ToolInfo(
                        name=name,
                        description=schema.get("description"),
                        schema=schema,
                        toolset=registry.get_toolset_for_tool(name),
                    )
                )
            return [r for r in rows if r.name]
        except Exception as exc:
            raise ToolsUnavailableError(f"Tool registry unavailable: {exc}") from exc

    def reload_tools(self) -> list[ToolInfo]:
        return self.list_tools()
