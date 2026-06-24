"""Unit tests for terminal and process tool policy enforcement in desktop_tool_overrides.py.

Tests verify that terminal and process wrappers enforce workspace containment
via resolve_path() from workspace_policy.
"""
from __future__ import annotations

import importlib
import json
import os
import subprocess
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
                "search_files", "todo", "terminal", "process", "execute_code"),
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

    def test_terminal_command_with_tmp_path_is_denied(self, installed_wrappers):
        """terminal command referencing /tmp is denied as outside workspace data."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["terminal"]
        result_json = wrapper({
            "command": "cat /tmp/some_temp_file",
            "workdir": str(tmp_path),
        })
        result = json.loads(result_json)

        assert result.get("code") == "WORKSPACE_VIOLATION"
        assert "outside path" in result.get("error", "")
        entries["terminal"].handler.assert_not_called()

    def test_terminal_command_with_system_executable_is_allowed(self, installed_wrappers):
        """terminal command containing a system executable path is allowed (not a data-file violation)."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["terminal"]
        for cmd in [
            "/usr/bin/python3 script.py",
            "/bin/bash -c 'ls'",
            "ls 2>/dev/null",
        ]:
            entries["terminal"].handler.reset_mock()
            result_json = wrapper({"command": cmd, "workdir": str(tmp_path)})
            result = json.loads(result_json)
            assert result.get("result") == "ok", f"command {cmd!r} was unexpectedly denied: {result}"
            entries["terminal"].handler.assert_called_once()

    def test_terminal_no_workdir_defaults_to_snapshot_cwd(self, installed_wrappers):
        """When no workdir/cwd provided, should default to snapshot.cwd (the workspace)."""
        wrappers, entries, workspace = installed_wrappers

        wrapper = wrappers["terminal"]
        result_json = wrapper({"command": "ls"})  # no workdir key
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        assert entries["terminal"].handler.called
        called_args = entries["terminal"].handler.call_args[0][0]
        assert called_args["workdir"] == str(workspace)

    def test_local_terminal_fails_closed_when_sandbox_runner_unavailable(self, installed_wrappers):
        """Local terminal must not run unsandboxed when no macOS sandbox runner is available."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["terminal"]
        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=None),
        ):
            result_json = wrapper({"command": "python -c 'print(1)'", "workdir": str(tmp_path)})

        result = json.loads(result_json)
        assert result.get("code") == "SANDBOX_UNAVAILABLE"
        entries["terminal"].handler.assert_not_called()

    def test_local_terminal_background_pty_fails_closed(self, installed_wrappers):
        """Local background PTY must not bypass the subprocess sandbox proxy."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["terminal"]
        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=MagicMock()),
        ):
            result_json = wrapper({
                "command": "python -i",
                "background": True,
                "pty": True,
                "workdir": str(tmp_path),
            })

        result = json.loads(result_json)
        assert result.get("code") == "SANDBOX_UNAVAILABLE"
        assert "pty" in result.get("error", "").lower()
        entries["terminal"].handler.assert_not_called()

    def test_local_terminal_handler_runs_with_sandboxed_subprocess_proxies(self, installed_wrappers):
        """Foreground/background local terminal spawn modules must see a sandboxed Popen proxy."""
        import tools.environments.local as local_env
        import tools.process_registry as process_registry

        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["terminal"]

        original_local_popen = local_env.subprocess.Popen
        original_registry_popen = process_registry.subprocess.Popen
        original_global_popen = subprocess.Popen
        seen = []

        def capturing_terminal_handler(args, **kwargs):
            seen.append({
                "local_popen_is_proxy": local_env.subprocess.Popen is not original_local_popen,
                "registry_popen_is_proxy": process_registry.subprocess.Popen is not original_registry_popen,
                "global_popen_is_original": subprocess.Popen is original_global_popen,
            })
            local_env.subprocess.Popen(["python"], stdout="local-stdout")
            process_registry.subprocess.Popen(["python"], stderr="registry-stderr")
            return json.dumps({"result": "ok"})

        entries["terminal"].handler = MagicMock(side_effect=capturing_terminal_handler)
        mock_runner = MagicMock()

        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=mock_runner),
        ):
            result_json = wrapper({"command": "python -c 'print(1)'", "workdir": str(tmp_path)})

        assert json.loads(result_json).get("result") == "ok"
        assert seen == [{
            "local_popen_is_proxy": True,
            "registry_popen_is_proxy": True,
            "global_popen_is_original": True,
        }]
        assert local_env.subprocess.Popen is original_local_popen
        assert process_registry.subprocess.Popen is original_registry_popen
        assert subprocess.Popen is original_global_popen
        assert mock_runner.popen.call_count == 2

    def test_local_terminal_handler_runs_with_workspace_scratch_tmpdir(
        self, installed_wrappers, monkeypatch
    ):
        """Local terminal must use workspace-local scratch for TMPDIR and Git config."""
        import tools.environments.local as local_env

        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["terminal"]
        monkeypatch.setenv("TMPDIR", "/tmp/outside-hermes")
        monkeypatch.setenv("HOME", "/Users/example")
        seen = []

        def capturing_terminal_handler(args, **kwargs):
            seen.append({
                "tmpdir": os.environ.get("TMPDIR"),
                "tmp": os.environ.get("TMP"),
                "temp": os.environ.get("TEMP"),
                "home": os.environ.get("HOME"),
                "git_config_global": os.environ.get("GIT_CONFIG_GLOBAL"),
                "xdg_config_home": os.environ.get("XDG_CONFIG_HOME"),
                "tempfile_tempdir": local_env.tempfile.tempdir,
                "tempfile_gettempdir": local_env.tempfile.gettempdir(),
            })
            return json.dumps({"result": "ok"})

        entries["terminal"].handler = MagicMock(side_effect=capturing_terminal_handler)

        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=MagicMock()),
        ):
            result_json = wrapper({"command": "python -c 'print(1)'", "workdir": str(tmp_path)})

        scratch = tmp_path / ".hermes-sandbox" / "tmp"
        assert json.loads(result_json).get("result") == "ok"
        assert seen == [{
            "tmpdir": str(scratch),
            "tmp": str(scratch),
            "temp": str(scratch),
            "home": str(scratch),
            "git_config_global": str(scratch / "gitconfig"),
            "xdg_config_home": str(scratch / "xdg-config"),
            "tempfile_tempdir": None,
            "tempfile_gettempdir": str(scratch),
        }]
        assert scratch.is_dir()
        assert (scratch / "gitconfig").is_file()
        assert os.environ.get("TMPDIR") == "/tmp/outside-hermes"
        assert os.environ.get("HOME") == "/Users/example"

    def test_local_terminal_background_registers_process_for_same_session(self, installed_wrappers):
        """terminal(background=true) must register the returned proc id for later process calls."""
        wrappers, entries, tmp_path = installed_wrappers

        terminal_wrapper = wrappers["terminal"]
        process_wrapper = wrappers["process"]
        entries["terminal"].handler = MagicMock(return_value=json.dumps({
            "status": "started",
            "session_id": "proc_owned",
        }))
        entries["process"].handler = MagicMock(return_value=json.dumps({"status": "running"}))

        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=MagicMock()),
        ):
            terminal_result = json.loads(terminal_wrapper({
                "command": "sleep 30",
                "background": True,
                "workdir": str(tmp_path),
            }))

        assert terminal_result["session_id"] == "proc_owned"

        process_result = json.loads(process_wrapper({"action": "poll", "session_id": "proc_owned"}))
        assert process_result == {"status": "running"}
        entries["process"].handler.assert_called_once()

    def test_process_owned_by_different_desktop_session_is_denied(self, installed_wrappers):
        """Process ownership must include desktop session_id, not only workspace_hash."""
        from daemon.services.workspace_policy import (
            build_workspace_policy_snapshot,
            reset_workspace_policy_snapshot,
            set_workspace_policy_snapshot,
        )

        wrappers, entries, tmp_path = installed_wrappers
        terminal_wrapper = wrappers["terminal"]
        process_wrapper = wrappers["process"]
        entries["terminal"].handler = MagicMock(return_value=json.dumps({
            "status": "started",
            "session_id": "proc_session_scoped",
        }))

        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=MagicMock()),
        ):
            terminal_wrapper({
                "command": "sleep 30",
                "background": True,
                "workdir": str(tmp_path),
            })

        other_snapshot = build_workspace_policy_snapshot("sess2", "turn2", str(tmp_path), "auto")
        token = set_workspace_policy_snapshot(other_snapshot)
        try:
            result = json.loads(process_wrapper({"action": "poll", "session_id": "proc_session_scoped"}))
        finally:
            reset_workspace_policy_snapshot(token)

        assert result.get("code") == "PROCESS_NOT_OWNED"
        entries["process"].handler.assert_not_called()

    def test_process_list_is_filtered_to_owned_processes(self, installed_wrappers):
        """process(action=list) must not reveal processes from other desktop sessions."""
        wrappers, entries, tmp_path = installed_wrappers
        terminal_wrapper = wrappers["terminal"]
        process_wrapper = wrappers["process"]
        entries["terminal"].handler = MagicMock(return_value=json.dumps({
            "status": "started",
            "session_id": "proc_visible",
        }))
        entries["process"].handler = MagicMock(return_value=json.dumps({
            "processes": [
                {"session_id": "proc_visible", "command": "owned"},
                {"session_id": "proc_hidden", "command": "foreign"},
            ]
        }))

        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=MagicMock()),
        ):
            terminal_wrapper({
                "command": "sleep 30",
                "background": True,
                "workdir": str(tmp_path),
            })

        result = json.loads(process_wrapper({"action": "list"}))

        assert result == {"processes": [{"session_id": "proc_visible", "command": "owned"}]}


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


# ---------------------------------------------------------------------------
# Tests: process ownership enforcement (V2 red tests)
# ---------------------------------------------------------------------------


class TestProcessOwnershipEnforcement:
    """V2: process poll/log/wait/kill/write/submit/close must verify session ownership."""

    def test_process_poll_unknown_session_denied(self, installed_wrappers):
        """process with action='poll' and unknown process ID must be denied.

        V1 bug: no-path actions pass through without ownership check.
        """
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["process"]
        # 'unknown-proc-id-xyz' was never registered by a spawn in this session
        result_json = wrapper({"action": "poll", "id": "unknown-proc-id-xyz"})
        result = json.loads(result_json)

        assert result.get("code") in ("WORKSPACE_VIOLATION", "PROCESS_NOT_OWNED"), (
            f"process poll with unknown ID must be denied, got: {result}"
        )
        entries["process"].handler.assert_not_called()

    def test_process_kill_unknown_session_denied(self, installed_wrappers):
        """process with action='kill' and unknown process ID must be denied."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["process"]
        result_json = wrapper({"action": "kill", "id": "unknown-proc-id-xyz"})
        result = json.loads(result_json)

        assert result.get("code") in ("WORKSPACE_VIOLATION", "PROCESS_NOT_OWNED"), (
            f"process kill with unknown ID must be denied, got: {result}"
        )
        entries["process"].handler.assert_not_called()


# ---------------------------------------------------------------------------
# Tests: terminal dangerous-command approval gate (security.dangerous_commands)
# ---------------------------------------------------------------------------


class TestTerminalDangerousCommandGate:
    """The terminal wrapper must route commands matching
    security.dangerous_commands through the human approval flow when approvals
    are enabled. Non-dangerous commands and explicit approval bypasses must not
    be gated."""

    def _gate_config(self, dangerous_commands):
        """Patch read_security_config to return a fixed dangerous list."""
        return patch(
            "daemon.readers.hermes_config.read_security_config",
            return_value={
                "dangerous_commands": dangerous_commands,
                "approval_required": True,
            },
        )

    def test_dangerous_command_approved_proceeds(self, installed_wrappers):
        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["terminal"]

        with self._gate_config(["rm -rf"]), patch(
            "tools.path_approval.request_path_approval", return_value="once"
        ) as mock_pa:
            result_json = wrapper({"command": "rm -rf build", "workdir": str(tmp_path)})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        mock_pa.assert_called_once()
        entries["terminal"].handler.assert_called_once()

    def test_dangerous_command_denied_blocks_execution(self, installed_wrappers):
        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["terminal"]

        with self._gate_config(["rm -rf"]), patch(
            "tools.path_approval.request_path_approval", return_value="deny"
        ):
            result_json = wrapper({"command": "rm -rf build", "workdir": str(tmp_path)})
        result = json.loads(result_json)

        assert result.get("code") == "DENIED"
        entries["terminal"].handler.assert_not_called()

    def test_non_dangerous_command_skips_approval(self, installed_wrappers):
        """A command that does not match any dangerous pattern never calls approval."""
        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["terminal"]

        with self._gate_config(["rm -rf"]), patch(
            "tools.path_approval.request_path_approval", return_value="once"
        ) as mock_pa:
            result_json = wrapper({"command": "ls -la", "workdir": str(tmp_path)})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        mock_pa.assert_not_called()

    def test_full_mode_skips_dangerous_command_approval(self, installed_wrappers):
        """permission_mode='full' skips dangerous-command approval, but still executes via wrapper."""
        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["terminal"]

        import tools.path_approval as pa

        tokens = pa.set_workspace_context(
            str(tmp_path), "sess1", "turn1", permission_mode="full"
        )
        try:
            with self._gate_config(["sudo"]), patch(
                "tools.path_approval.request_path_approval", return_value="deny"
            ) as mock_pa:
                result_json = wrapper({"command": "sudo ls", "workdir": str(tmp_path)})
            result = json.loads(result_json)
        finally:
            pa.reset_workspace_context(tokens)

        assert result.get("result") == "ok"
        mock_pa.assert_not_called()
        entries["terminal"].handler.assert_called_once()

    def test_approvals_mode_off_skips_dangerous_command_approval(self, installed_wrappers):
        """approvals.mode=off skips the prompt without bypassing the terminal wrapper."""
        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["terminal"]

        with self._gate_config(["rm -rf"]), patch(
            "tools.approval._get_approval_mode", return_value="off"
        ), patch(
            "tools.path_approval.request_path_approval", return_value="deny"
        ) as mock_pa:
            result_json = wrapper({"command": "rm -rf build", "workdir": str(tmp_path)})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        mock_pa.assert_not_called()
        entries["terminal"].handler.assert_called_once()

    def test_session_yolo_skips_dangerous_command_approval(self, installed_wrappers):
        """Session YOLO skips the prompt without bypassing the terminal wrapper."""
        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["terminal"]

        with self._gate_config(["sudo"]), patch(
            "tools.approval.is_session_yolo_enabled", return_value=True
        ), patch(
            "tools.path_approval.request_path_approval", return_value="deny"
        ) as mock_pa:
            result_json = wrapper({"command": "sudo ls", "workdir": str(tmp_path)})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        mock_pa.assert_not_called()
        entries["terminal"].handler.assert_called_once()

    def test_approval_required_false_skips_gate(self, installed_wrappers):
        """When security.approval_required is False, no approval is requested."""
        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["terminal"]

        with patch(
            "daemon.readers.hermes_config.read_security_config",
            return_value={
                "dangerous_commands": ["rm -rf"],
                "approval_required": False,
            },
        ), patch(
            "tools.path_approval.request_path_approval", return_value="once"
        ) as mock_pa:
            result_json = wrapper({"command": "rm -rf build", "workdir": str(tmp_path)})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        mock_pa.assert_not_called()
