"""Unit tests for desktop tool override infrastructure."""
from __future__ import annotations

import importlib
import json
import sys
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
                              "search_files", "todo", "terminal", "process",
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

class TestPyInstallerRequiredToolImports:
    def test_direct_imports_register_todo_without_filesystem_discovery(self):
        """PyInstaller bundles put tools in PYZ, so glob-based discovery may
        find nothing. The desktop startup helper must directly import every
        tool that install_desktop_tool_overrides() requires, including todo.
        """
        overrides = _fresh_overrides_module()
        import tools.registry as registry_module

        registry = registry_module.registry
        registry.deregister("todo")
        sys.modules.pop("tools.todo_tool", None)
        assert registry.get_entry("todo") is None

        try:
            overrides._import_required_tool_modules()
            assert registry.get_entry("todo") is not None
        finally:
            if registry.get_entry("todo") is None:
                importlib.import_module("tools.todo_tool")


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

    def test_plan_mode_blocks_mutating_tools_but_allows_read_tools(self):
        """Plan Mode denies mutating desktop tools while preserving read/search access."""
        import pathlib
        import tempfile
        from daemon.services.workspace_policy import PolicyDecision

        with tempfile.TemporaryDirectory() as tmpdir:
            canonical_path = pathlib.Path(tmpdir)
            fake_snapshot = MagicMock()
            fake_snapshot.collaboration_mode = "plan"
            fake_snapshot.cwd = canonical_path
            fake_snapshot.workspace_root = canonical_path

            fake_decision = PolicyDecision(
                allowed=True,
                requires_approval=False,
                reason="path is within workspace",
                resolved_path=canonical_path / "file.txt",
            )

            fake_workspace_policy = MagicMock()
            fake_workspace_policy.get_workspace_policy_snapshot = MagicMock(return_value=fake_snapshot)
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

                read_result = json.loads(registered_wrappers["read_file"]({"path": "file.txt"}))
                write_result = json.loads(registered_wrappers["write_file"]({"path": "file.txt", "content": "x"}))
                patch_result = json.loads(registered_wrappers["patch"]({"path": "file.txt", "content": "x"}))
                execute_code_result = json.loads(registered_wrappers["execute_code"]({"code": "print(1)"}))
                process_result = json.loads(registered_wrappers["process"]({"action": "list"}))
                todo_result = json.loads(registered_wrappers["todo"]({"todos": []}))

        assert read_result.get("result") == "ok"
        assert write_result.get("code") == "PLAN_MODE_RESTRICTED"
        assert patch_result.get("code") == "PLAN_MODE_RESTRICTED"
        assert execute_code_result.get("code") == "PLAN_MODE_RESTRICTED"
        assert process_result.get("code") == "PLAN_MODE_RESTRICTED"
        assert todo_result.get("code") == "PLAN_MODE_RESTRICTED"
        fake_entries["read_file"].handler.assert_called_once()
        fake_entries["write_file"].handler.assert_not_called()
        fake_entries["patch"].handler.assert_not_called()
        fake_entries["execute_code"].handler.assert_not_called()
        fake_entries["process"].handler.assert_not_called()
        fake_entries["todo"].handler.assert_not_called()

    def test_agent_runtime_blocks_update_plan_in_desktop_plan_mode(self):
        """update_plan is denied by the agent runtime in desktop Plan Mode."""
        from agent.agent_runtime_helpers import invoke_tool

        fake_agent = MagicMock()
        fake_agent._desktop_collaboration_mode = "plan"
        fake_agent.session_id = "sess"
        fake_agent._current_turn_id = "turn"
        fake_agent._current_api_request_id = "req"

        def run_middleware(_name, args, execute, **_kwargs):
            return execute(args)

        fake_middleware = MagicMock()
        fake_middleware.run_tool_execution_middleware.side_effect = run_middleware
        fake_model_tools = MagicMock()
        fake_model_tools._emit_post_tool_call_hook = MagicMock()

        with patch.dict(sys.modules, {
            "hermes_cli.middleware": fake_middleware,
            "model_tools": fake_model_tools,
        }):
            result_json = invoke_tool(
                fake_agent,
                "update_plan",
                {"plan": [{"step": "inspect", "status": "in_progress"}]},
                "task",
                skip_tool_request_middleware=True,
            )

        result = json.loads(result_json)
        assert result.get("code") == "PLAN_MODE_RESTRICTED"
        assert "update_plan" in result.get("error", "")

    def test_dangerous_command_config_read_failure_requires_approval(self):
        """Dangerous command gate must fail closed when runtime config cannot be read."""
        import pathlib
        import tempfile
        from daemon.services.workspace_policy import (
            build_workspace_policy_snapshot,
            reset_workspace_policy_snapshot,
            set_workspace_policy_snapshot,
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = pathlib.Path(tmpdir)
            snap = build_workspace_policy_snapshot("sess", "turn", tmpdir, "full")
            token = set_workspace_policy_snapshot(snap)
            overrides = _fresh_overrides_module()
            fake_entries, fake_registry, fake_registry_module, fake_model_tools = _build_mocks()
            registered_wrappers: dict[str, MagicMock] = {}

            def capture_register(**kwargs):
                if kwargs.get("override"):
                    registered_wrappers[kwargs["name"]] = kwargs["handler"]

            fake_registry.register.side_effect = capture_register

            fake_config_reader = MagicMock()
            fake_config_reader.read_security_config.side_effect = RuntimeError("boom")

            try:
                with (
                    patch.dict(sys.modules, {
                        "tools.registry": fake_registry_module,
                        "model_tools": fake_model_tools,
                        "daemon.readers.hermes_config": fake_config_reader,
                    }),
                    patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
                    patch("tools.path_approval.request_path_approval", return_value="deny") as request_approval,
                ):
                    overrides.install_desktop_tool_overrides()
                    result_json = registered_wrappers["terminal"]({
                        "command": "rm -rf build",
                        "workdir": str(workspace),
                    })
            finally:
                reset_workspace_policy_snapshot(token)

        result = json.loads(result_json)
        assert result.get("code") == "DENIED"
        request_approval.assert_called_once()
        fake_entries["terminal"].handler.assert_not_called()


# ---------------------------------------------------------------------------
# Test 4: importing shared tool modules does not install desktop overrides
# ---------------------------------------------------------------------------

class TestInstallFailsOnMissingTool:
    """V2: install_desktop_tool_overrides must raise RuntimeError if any expected tool is missing."""

    def test_missing_tool_raises_runtime_error(self):
        """If any expected tool original is not found, install must raise RuntimeError.

        V1 bug: missing tools are silently skipped.
        """
        import pytest as _pytest

        overrides = _fresh_overrides_module()

        # Provide every required original except "execute_code".
        tool_names = ["read_file", "write_file", "patch", "search_files", "todo", "terminal", "process"]
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
        tools.registry.registry.deregister("request_user_input")
        tools.registry.registry.deregister("update_plan")

        assert overrides._INSTALLED is False
        assert tools.registry.registry.get_entry("request_user_input") is None
        assert tools.registry.registry.get_entry("update_plan") is None

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

    def test_plan_tools_registered_only_by_desktop_install(self):
        """Desktop-only plan tools are registered by the Tauri sidecar install hook."""
        overrides = _fresh_overrides_module()
        _, fake_registry, fake_registry_module, fake_model_tools = _build_mocks()

        registered: dict[str, dict] = {}

        def capture_register(**kwargs):
            registered[kwargs["name"]] = kwargs

        fake_registry.register.side_effect = capture_register

        with patch.dict(sys.modules, {
            "tools.registry": fake_registry_module,
            "model_tools": fake_model_tools,
        }):
            overrides.install_desktop_tool_overrides()

        assert "request_user_input" in registered
        assert registered["request_user_input"]["toolset"] == "desktop_plan"
        assert "update_plan" in registered
        assert registered["update_plan"]["toolset"] == "desktop_plan"
