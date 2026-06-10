"""Unit tests for execute_code sandbox enforcement in desktop_tool_overrides.py.

Tests verify:
1. execute_code wrapper returns SANDBOX_UNAVAILABLE when get_sandbox_runner() returns None
2. execute_code wrapper fails closed (POLICY_MISSING) with no active snapshot
3. execute_code wrapper passes through to original when sandbox is available and snapshot is active
4. get_sandbox_runner() returns None on non-macOS (mock sys.platform)
5. _build_seatbelt_policy includes the workspace root path in the policy string
"""
from __future__ import annotations

import importlib
import json
import sys
from types import ModuleType
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
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
# Fixture: workspace snapshot
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
# Test 1: SANDBOX_UNAVAILABLE when get_sandbox_runner() returns None
# ---------------------------------------------------------------------------


class TestExecuteCodeSandboxUnavailable:
    def test_execute_code_returns_sandbox_unavailable_when_runner_is_none(
        self, installed_wrappers
    ):
        """execute_code wrapper returns SANDBOX_UNAVAILABLE when get_sandbox_runner() returns None."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["execute_code"]

        # Patch get_sandbox_runner to return None (simulate non-macOS / no sandbox-exec)
        with patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=None):
            result_json = wrapper({"language": "python", "code": "print('hello')"})

        result = json.loads(result_json)
        assert result.get("code") == "SANDBOX_UNAVAILABLE"
        assert "sandbox" in result.get("error", "").lower()
        entries["execute_code"].handler.assert_not_called()


# ---------------------------------------------------------------------------
# Test 2: POLICY_MISSING when no active snapshot
# ---------------------------------------------------------------------------


class TestExecuteCodePolicyMissing:
    def test_execute_code_fails_closed_without_snapshot(self):
        """execute_code wrapper returns POLICY_MISSING when no workspace snapshot is active."""
        overrides = _fresh_overrides_module()
        (fake_entries, fake_registry,
         fake_registry_module, fake_model_tools,
         registered_wrappers) = _build_fake_registry_and_entries()

        with patch.dict(sys.modules, {
            "tools.registry": fake_registry_module,
            "model_tools": fake_model_tools,
        }):
            overrides.install_desktop_tool_overrides()

        # No snapshot is active (default ContextVar is None)
        wrapper = registered_wrappers["execute_code"]
        result_json = wrapper({"language": "python", "code": "print('hello')"})
        result = json.loads(result_json)

        assert result.get("code") == "POLICY_MISSING"
        fake_entries["execute_code"].handler.assert_not_called()


# ---------------------------------------------------------------------------
# Test 3: passes through to original when sandbox is available and snapshot active
# ---------------------------------------------------------------------------


class TestExecuteCodePassthrough:
    def test_execute_code_passes_through_when_sandbox_available(
        self, installed_wrappers
    ):
        """execute_code calls original handler when sandbox runner is available and snapshot is active."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["execute_code"]

        # Create a mock runner that reports available
        mock_runner = MagicMock()
        mock_runner.is_available.return_value = True

        with patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=mock_runner):
            result_json = wrapper({"language": "python", "code": "print('hello')"})

        result = json.loads(result_json)
        assert result.get("result") == "ok"
        entries["execute_code"].handler.assert_called_once()


# ---------------------------------------------------------------------------
# Test 4: get_sandbox_runner returns None on non-macOS
# ---------------------------------------------------------------------------


class TestGetSandboxRunnerNonMacOS:
    def test_get_sandbox_runner_returns_none_on_non_macos(self):
        """get_sandbox_runner() returns None when sys.platform is not 'darwin'."""
        # Force a fresh _RUNNER so the cached value doesn't interfere
        import daemon.services.sandbox_runner as sr

        original_runner = sr._RUNNER
        sr._RUNNER = None

        try:
            with patch.object(sys, "platform", "linux"):
                runner = sr.get_sandbox_runner()
            assert runner is None
        finally:
            sr._RUNNER = original_runner


# ---------------------------------------------------------------------------
# Test 5: _build_seatbelt_policy includes workspace root in policy string
# ---------------------------------------------------------------------------


class TestBuildSeatbeltPolicy:
    def test_policy_contains_workspace_root(self, tmp_path):
        """_build_seatbelt_policy embeds the workspace_root path in the policy."""
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        workspace_root = str(tmp_path)
        policy = _build_seatbelt_policy(workspace_root)

        assert workspace_root in policy

    def test_policy_denies_hermes_env_path(self, tmp_path):
        """_build_seatbelt_policy includes a deny rule for the hermes .env file."""
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        hermes_home = str(tmp_path / ".hermes")
        policy = _build_seatbelt_policy(str(tmp_path), hermes_home=hermes_home)

        expected_env_path = str(tmp_path / ".hermes" / ".env")
        assert expected_env_path in policy
        # The deny rule must come after the workspace allow rule
        deny_pos = policy.find('(deny file-read*')
        allow_pos = policy.find('(allow file-read* file-write* file-test-existence')
        assert deny_pos > allow_pos, "deny rule for .env should appear after the workspace allow rule"
