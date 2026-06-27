from __future__ import annotations

import importlib
import json
import sys
from types import ModuleType
from unittest.mock import MagicMock

DEFAULT_DESKTOP_TOOL_NAMES = (
    "read_file",
    "write_file",
    "patch",
    "search_files",
    "todo",
    "terminal",
    "process",
    "execute_code",
)


def make_fake_tool_entry(name: str, toolset: str = "builtin") -> MagicMock:
    entry = MagicMock()
    entry.name = name
    entry.toolset = toolset
    entry.schema = {"name": name, "description": f"tool {name}"}
    entry.handler = MagicMock(return_value=json.dumps({"result": "ok"}))
    entry.check_fn = None
    entry.requires_env = []
    entry.is_async = False
    entry.description = f"tool {name}"
    entry.emoji = ""
    entry.max_result_size_chars = None
    entry.dynamic_schema_overrides = None
    return entry


def fresh_desktop_overrides_module() -> ModuleType:
    mod_name = "daemon.tools.desktop_tool_overrides"
    for key in list(sys.modules.keys()):
        if key == mod_name or key.startswith(mod_name + "."):
            del sys.modules[key]
    return importlib.import_module(mod_name)


def build_fake_registry(
    tool_names: tuple[str, ...] = DEFAULT_DESKTOP_TOOL_NAMES,
) -> tuple[dict[str, MagicMock], MagicMock, MagicMock, MagicMock]:
    fake_entries = {name: make_fake_tool_entry(name) for name in tool_names}

    fake_registry = MagicMock()
    fake_registry.get_entry.side_effect = lambda name: fake_entries.get(name)

    fake_registry_module = MagicMock()
    fake_registry_module.registry = fake_registry
    fake_registry_module.discover_builtin_tools = MagicMock()

    fake_model_tools = MagicMock()
    fake_model_tools._clear_tool_defs_cache = MagicMock()

    return fake_entries, fake_registry, fake_registry_module, fake_model_tools


def build_fake_registry_and_entries(
    tool_names: tuple[str, ...] = DEFAULT_DESKTOP_TOOL_NAMES,
) -> tuple[dict[str, MagicMock], MagicMock, MagicMock, MagicMock, dict[str, MagicMock]]:
    fake_entries, fake_registry, fake_registry_module, fake_model_tools = build_fake_registry(tool_names)
    registered_wrappers: dict[str, MagicMock] = {}

    def capture_register(**kwargs):
        if kwargs.get("override"):
            registered_wrappers[kwargs["name"]] = kwargs["handler"]

    fake_registry.register.side_effect = capture_register

    return fake_entries, fake_registry, fake_registry_module, fake_model_tools, registered_wrappers
