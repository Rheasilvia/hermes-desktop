"""Unit tests for desktop tool override infrastructure."""
from __future__ import annotations

import importlib
import json
import sys
from types import ModuleType
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fake_entry(name: str, toolset: str = "builtin") -> MagicMock:
    """Return a mock ToolEntry-like object."""
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


def _fresh_overrides_module():
    """Re-import desktop_tool_overrides with a clean state (no _INSTALLED flag)."""
    mod_name = "daemon.tools.desktop_tool_overrides"
    # Remove cached module so we get a fresh _INSTALLED = False
    for key in list(sys.modules.keys()):
        if key == mod_name or key.startswith(mod_name + "."):
            del sys.modules[key]
    return importlib.import_module(mod_name)


# ---------------------------------------------------------------------------
# Shared mock context
# ---------------------------------------------------------------------------

def _build_mocks(tool_names=("read_file", "write_file", "patch",
                              "search_files", "terminal", "process",
                              "execute_code")):
    """Build a consistent set of mocks for the three modules we patch."""
    fake_entries = {name: _make_fake_entry(name) for name in tool_names}

    fake_registry = MagicMock()
    fake_registry.get_entry.side_effect = lambda name: fake_entries.get(name)

    fake_registry_module = MagicMock()
    fake_registry_module.registry = fake_registry
    fake_registry_module.discover_builtin_tools = MagicMock()

    fake_model_tools = MagicMock()
    fake_model_tools._clear_tool_defs_cache = MagicMock()

    return fake_entries, fake_registry, fake_registry_module, fake_model_tools


# ---------------------------------------------------------------------------
# Test 1: install is idempotent
# ---------------------------------------------------------------------------

class TestInstallIdempotent:
    def test_install_twice_does_not_raise_and_installed_is_true(self):
        """Calling install_desktop_tool_overrides() twice must not raise."""
        overrides = _fresh_overrides_module()
        _, _, fake_registry_module, fake_model_tools = _build_mocks()

        with (
            patch.dict(sys.modules, {
                "tools.registry": fake_registry_module,
                "model_tools": fake_model_tools,
            }),
            patch.object(
                fake_registry_module.registry,
                "get_entry",
                side_effect=lambda name: _make_fake_entry(name),
            ),
        ):
            overrides.install_desktop_tool_overrides()
            overrides.install_desktop_tool_overrides()  # second call

        assert overrides._INSTALLED is True


# ---------------------------------------------------------------------------
# Test 2: originals captured before override
# ---------------------------------------------------------------------------

class TestOriginalsCapturedBeforeOverride:
    def test_read_file_original_is_not_the_wrapper(self):
        """After install, ORIGINAL_TOOLS['read_file'] must be the entry that
        existed before wrappers were installed — i.e. the pre-override handler."""
        overrides = _fresh_overrides_module()
        fake_entries, fake_registry, fake_registry_module, fake_model_tools = _build_mocks()

        with patch.dict(sys.modules, {
            "tools.registry": fake_registry_module,
            "model_tools": fake_model_tools,
        }):
            overrides.install_desktop_tool_overrides()

        original = overrides.ORIGINAL_TOOLS.get("read_file")
        assert original is not None, "read_file should be in ORIGINAL_TOOLS"
        # The original's handler must be the mock we set up, not the wrapper
        # function created inside _install_wrappers.
        assert original is fake_entries["read_file"]


# ---------------------------------------------------------------------------
# Test 3: wrappers fail closed without a snapshot
# ---------------------------------------------------------------------------

class TestWrapperFailsClosedWithoutSnapshot:
    def test_wrapped_handler_returns_policy_missing_without_snapshot(self):
        """When no workspace policy snapshot is active, the wrapped handler
        must return JSON with code='POLICY_MISSING' and not call the original."""
        overrides = _fresh_overrides_module()
        fake_entries, fake_registry, fake_registry_module, fake_model_tools = _build_mocks()

        # Track what gets registered with override=True
        registered_wrappers: dict[str, MagicMock] = {}

        def capture_register(**kwargs):
            if kwargs.get("override"):
                registered_wrappers[kwargs["name"]] = kwargs["handler"]

        fake_registry.register.side_effect = capture_register

        with patch.dict(sys.modules, {
            "tools.registry": fake_registry_module,
            "model_tools": fake_model_tools,
        }):
            overrides.install_desktop_tool_overrides()

        assert "read_file" in registered_wrappers, "read_file wrapper should have been registered"

        # Ensure no snapshot is active (default ContextVar is None)
        wrapper = registered_wrappers["read_file"]
        result_json = wrapper({"path": "/some/file.txt"})
        result = json.loads(result_json)

        assert result.get("code") == "POLICY_MISSING"
        # Original handler must NOT have been called
        fake_entries["read_file"].handler.assert_not_called()


# ---------------------------------------------------------------------------
# Test 3b: wrappers pass through positional args dict when snapshot is active
# ---------------------------------------------------------------------------

class TestWrapperPassThroughWithSnapshot:
    def test_wrapped_handler_passes_args_dict_positionally_when_snapshot_active(self):
        """When a workspace policy snapshot IS active, the wrapper must call
        original_entry.handler with the args dict as the positional first argument.

        read_file now enforces path policy via resolve_path, so we need
        resolve_path to return an allowed PolicyDecision.  We use a real snapshot
        and a real resolve_path call (by injecting a real workspace into the
        fake workspace_policy module) so the handler is actually reached.
        """
        import pathlib
        import tempfile
        from daemon.services.workspace_policy import (
            PolicyDecision,
            build_workspace_policy_snapshot,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            canonical_path = pathlib.Path(tmpdir)
            fake_snapshot = build_workspace_policy_snapshot(
                "sess", "turn", tmpdir, "auto"
            )

            # Build a PolicyDecision that allows the path — resolved_path must be a Path
            allowed_path = canonical_path / "file.txt"
            fake_decision = PolicyDecision(
                allowed=True,
                requires_approval=False,
                reason="path is within workspace",
                resolved_path=allowed_path,
            )

            fake_workspace_policy = MagicMock()
            fake_workspace_policy.get_workspace_policy_snapshot = MagicMock(
                return_value=fake_snapshot
            )
            fake_workspace_policy.resolve_path = MagicMock(return_value=fake_decision)

            overrides = _fresh_overrides_module()
            fake_entries, fake_registry, fake_registry_module, fake_model_tools = _build_mocks()

            registered_wrappers: dict[str, MagicMock] = {}

            def capture_register(**kwargs):
                if kwargs.get("override"):
                    registered_wrappers[kwargs["name"]] = kwargs["handler"]

            fake_registry.register.side_effect = capture_register

            with patch.dict(sys.modules, {
                "tools.registry": fake_registry_module,
                "model_tools": fake_model_tools,
                "daemon.services.workspace_policy": fake_workspace_policy,
            }):
                overrides.install_desktop_tool_overrides()

                assert "read_file" in registered_wrappers

                wrapper = registered_wrappers["read_file"]
                args_dict = {"path": str(allowed_path)}
                result_json = wrapper(args_dict)

        # handler must have been called exactly once — with canonical path rewritten
        fake_entries["read_file"].handler.assert_called_once()
        result = json.loads(result_json)
        assert result.get("result") == "ok"


# ---------------------------------------------------------------------------
# Test 4: importing shared tool modules does not install desktop overrides
# ---------------------------------------------------------------------------

class TestInstallFailsOnMissingTool:
    """V2: install_desktop_tool_overrides must raise RuntimeError if any expected tool is missing."""

    def test_missing_tool_raises_runtime_error(self):
        """If any of the 7 expected tool originals is not found, install must raise RuntimeError.

        V1 bug: missing tools are silently skipped.
        """
        import pytest as _pytest

        overrides = _fresh_overrides_module()

        # Only provide 6 of the 7 required tools (missing "execute_code")
        tool_names = ["read_file", "write_file", "patch", "search_files", "terminal", "process"]
        fake_entries = {name: _make_fake_entry(name) for name in tool_names}

        fake_registry = MagicMock()
        fake_registry.get_entry.side_effect = lambda name: fake_entries.get(name)  # returns None for execute_code
        fake_registry.register = MagicMock()

        fake_registry_module = MagicMock()
        fake_registry_module.registry = fake_registry
        fake_registry_module.discover_builtin_tools = MagicMock()

        fake_model_tools = MagicMock()
        fake_model_tools._clear_tool_defs_cache = MagicMock()

        with patch.dict(sys.modules, {
            "tools.registry": fake_registry_module,
            "model_tools": fake_model_tools,
        }):
            with _pytest.raises(RuntimeError, match="execute_code"):
                overrides.install_desktop_tool_overrides()


# ---------------------------------------------------------------------------
# Test 5: importing shared tool modules does not install desktop overrides
# ---------------------------------------------------------------------------


class TestSharedImportDoesNotInstallOverrides:
    def test_importing_tools_registry_does_not_set_installed(self):
        """Importing tools.registry or a tool module must not touch _INSTALLED."""
        overrides = _fresh_overrides_module()

        # _INSTALLED starts False in a fresh module
        assert overrides._INSTALLED is False

        # Importing the shared registry module must not mutate _INSTALLED
        import tools.registry  # noqa: F401

        assert overrides._INSTALLED is False

    def test_installed_only_after_explicit_call(self):
        """_INSTALLED must remain False until install_desktop_tool_overrides() is called."""
        overrides = _fresh_overrides_module()
        _, _, fake_registry_module, fake_model_tools = _build_mocks()

        # Confirm still False before any explicit call
        assert overrides._INSTALLED is False

        with patch.dict(sys.modules, {
            "tools.registry": fake_registry_module,
            "model_tools": fake_model_tools,
        }):
            overrides.install_desktop_tool_overrides()

        assert overrides._INSTALLED is True
