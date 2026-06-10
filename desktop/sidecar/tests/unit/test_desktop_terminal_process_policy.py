"""Unit tests for terminal and process tool policy enforcement in desktop_tool_overrides.py.

Tests verify that terminal and process wrappers enforce workspace containment
via resolve_path() from workspace_policy.
"""
from __future__ import annotations

import importlib
import json
import sys
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers (same pattern as test_desktop_file_tool_policy.py)
# ---------------------------------------------------------------------------


def _make_fake_entry(name: str, toolset: str = "builtin") -> MagicMock:
    """Return a mock ToolEntry-like object with a handler that returns JSON ok."""
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


def _fresh_overrides_module() -> ModuleType:
    """Re-import desktop_tool_overrides with a clean state (no _INSTALLED flag)."""
    mod_name = "daemon.tools.desktop_tool_overrides"
    for key in list(sys.modules.keys()):
        if key == mod_name or key.startswith(mod_name + "."):
            del sys.modules[key]
    return importlib.import_module(mod_name)


def _build_fake_registry_and_entries(
    tool_names=("read_file", "write_file", "patch",
                "search_files", "terminal", "process", "execute_code"),
):
    """Create fake entries, registry, registry_module, and model_tools mocks."""
    fake_entries = {name: _make_fake_entry(name) for name in tool_names}

    registered_wrappers: dict[str, MagicMock] = {}

    fake_registry = MagicMock()
    fake_registry.get_entry.side_effect = lambda name: fake_entries.get(name)

    def capture_register(**kwargs):
        if kwargs.get("override"):
            registered_wrappers[kwargs["name"]] = kwargs["handler"]

    fake_registry.register.side_effect = capture_register

    fake_registry_module = MagicMock()
    fake_registry_module.registry = fake_registry
    fake_registry_module.discover_builtin_tools = MagicMock()

    fake_model_tools = MagicMock()
    fake_model_tools._clear_tool_defs_cache = MagicMock()

    return fake_entries, fake_registry, fake_registry_module, fake_model_tools, registered_wrappers


# ---------------------------------------------------------------------------
# Fixture: install wrappers with real workspace snapshot active
# ---------------------------------------------------------------------------


@pytest.fixture
def workspace(tmp_path):
    """Build a workspace policy snapshot for tmp_path and activate it."""
    from daemon.services.workspace_policy import (
        build_workspace_policy_snapshot,
        reset_workspace_policy_snapshot,
        set_workspace_policy_snapshot,
    )
    snap = build_workspace_policy_snapshot("sess1", "turn1", str(tmp_path), "auto")
    token = set_workspace_policy_snapshot(snap)
    yield tmp_path
    reset_workspace_policy_snapshot(token)


@pytest.fixture
def installed_wrappers(workspace):
    """Install wrappers over fake entries and yield (registered_wrappers, fake_entries, tmp_path)."""
    overrides = _fresh_overrides_module()
    (fake_entries, fake_registry,
     fake_registry_module, fake_model_tools,
     registered_wrappers) = _build_fake_registry_and_entries()

    with patch.dict(sys.modules, {
        "tools.registry": fake_registry_module,
        "model_tools": fake_model_tools,
    }):
        overrides.install_desktop_tool_overrides()

    return registered_wrappers, fake_entries, workspace


# ---------------------------------------------------------------------------
# Tests: terminal wrapper
# ---------------------------------------------------------------------------


class TestTerminalWrapper:
    def test_terminal_workspace_workdir_reaches_original_with_canonical_path(
        self, installed_wrappers
    ):
        """terminal with a workdir inside workspace should call original with canonical workdir."""
        wrappers, entries, tmp_path = installed_wrappers
        sub = tmp_path / "subdir"
        sub.mkdir()

        wrapper = wrappers["terminal"]
        result_json = wrapper({"command": "ls", "workdir": str(sub)})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        entries["terminal"].handler.assert_called_once()
        called_args = entries["terminal"].handler.call_args[0][0]
        # The wrapper must have rewritten workdir to canonical
        assert called_args["workdir"] == str(sub.resolve())

    def test_terminal_workdir_outside_workspace_is_denied(self, installed_wrappers):
        """terminal with workdir outside workspace must return WORKSPACE_VIOLATION."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["terminal"]
        result_json = wrapper({"command": "ls", "workdir": "/etc"})
        result = json.loads(result_json)

        assert result.get("code") == "WORKSPACE_VIOLATION"
        assert "denied" in result.get("error", "").lower()
        entries["terminal"].handler.assert_not_called()

    def test_terminal_command_with_existing_outside_abs_path_is_denied(
        self, installed_wrappers, tmp_path
    ):
        """terminal command containing an existing absolute path outside workspace is denied."""
        wrappers, entries, _workspace = installed_wrappers

        # Create a real file outside the workspace (in its parent dir)
        outside_file = tmp_path.parent / "outside_file.txt"
        outside_file.write_text("secret data")

        try:
            wrapper = wrappers["terminal"]
            result_json = wrapper({
                "command": f"cat {outside_file}",
                "workdir": str(tmp_path),
            })
            result = json.loads(result_json)

            assert result.get("code") == "WORKSPACE_VIOLATION"
            assert "denied" in result.get("error", "").lower()
            entries["terminal"].handler.assert_not_called()
        finally:
            outside_file.unlink(missing_ok=True)

    def test_terminal_command_with_tmp_path_is_allowed(self, installed_wrappers):
        """terminal command referencing /tmp is allowed (system temp path)."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["terminal"]
        result_json = wrapper({
            "command": "cat /tmp/some_temp_file",
            "workdir": str(tmp_path),
        })
        result = json.loads(result_json)

        # Should pass through — /tmp path is excluded from the scan
        assert result.get("result") == "ok"
        entries["terminal"].handler.assert_called_once()


# ---------------------------------------------------------------------------
# Tests: process wrapper
# ---------------------------------------------------------------------------


class TestProcessWrapper:
    def test_process_with_path_inside_workspace_reaches_original(
        self, installed_wrappers
    ):
        """process with path arg inside workspace should call original handler."""
        wrappers, entries, tmp_path = installed_wrappers
        inner = tmp_path / "app"
        inner.mkdir()

        wrapper = wrappers["process"]
        result_json = wrapper({"operation": "start", "path": str(inner)})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        entries["process"].handler.assert_called_once()

    def test_process_with_path_outside_workspace_is_denied(self, installed_wrappers):
        """process with path arg outside workspace must return WORKSPACE_VIOLATION."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["process"]
        result_json = wrapper({"operation": "start", "path": "/usr/bin/python"})
        result = json.loads(result_json)

        assert result.get("code") == "WORKSPACE_VIOLATION"
        assert "denied" in result.get("error", "").lower()
        entries["process"].handler.assert_not_called()

    def test_process_without_path_args_reaches_original(self, installed_wrappers):
        """process with no path arguments (e.g. list, kill by pid) should pass through."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["process"]
        result_json = wrapper({"operation": "list"})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        entries["process"].handler.assert_called_once()
