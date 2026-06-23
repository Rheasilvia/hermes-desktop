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
import os
import subprocess
import sys
import tempfile
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
    def test_policy_uses_workspace_param_not_literal(self, tmp_path):
        """Paths are passed as -D params (referenced via (param …)), never
        interpolated into the policy text — mirrors codex, removes escaping risk."""
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        workspace_root = str(tmp_path)
        policy, params = _build_seatbelt_policy(workspace_root)

        assert '(subpath (param "WORKSPACE_ROOT"))' in policy
        assert workspace_root not in policy  # the literal path must not appear in policy text
        assert ("WORKSPACE_ROOT", workspace_root) in params

    def test_policy_denies_hermes_home_via_param(self, tmp_path):
        """The hermes home deny uses a (param …) and appears after the workspace allow."""
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        hermes_home = str(tmp_path / ".hermes")
        policy, params = _build_seatbelt_policy(str(tmp_path), hermes_home=hermes_home)

        assert ("HERMES_HOME", hermes_home) in params
        assert '(deny file-read* file-write* (subpath (param "HERMES_HOME")))' in policy
        deny_pos = policy.find('(deny file-read* file-write* (subpath (param "HERMES_HOME"))')
        allow_pos = policy.find('(allow file-read* file-write* file-test-existence')
        assert deny_pos > allow_pos, "hermes home deny must appear after the workspace allow"

    def test_policy_denies_git_hooks_and_config(self, tmp_path):
        """Every discovered .git/hooks dir + top-level config are denied for writes."""
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        # The finder only protects hooks dirs that actually exist, so create
        # the top-level hooks dir (and a nested bare repo hooks dir) to exercise
        # the discovery + multi-deny path.
        (tmp_path / ".git" / "hooks").mkdir(parents=True)
        (tmp_path / "vendor" / "sub.git" / "hooks").mkdir(parents=True)

        policy, params = _build_seatbelt_policy(str(tmp_path))

        assert ("WS_GIT_CONFIG", str(tmp_path / ".git" / "config")) in params
        assert '(deny file-write* (literal (param "WS_GIT_CONFIG")))' in policy

        # Top-level hooks dir is discovered and denied as WS_GIT_HOOK_0.
        top_hooks = str((tmp_path / ".git" / "hooks").resolve())
        assert ("WS_GIT_HOOK_0", top_hooks) in params
        assert '(deny file-write* (subpath (param "WS_GIT_HOOK_0")))' in policy
        # The literal path must not be interpolated into the policy text.
        assert top_hooks not in policy

        # Nested bare repo hooks dir is discovered and denied as WS_GIT_HOOK_1.
        bare_hooks = str((tmp_path / "vendor" / "sub.git" / "hooks").resolve())
        assert ("WS_GIT_HOOK_1", bare_hooks) in params
        assert '(deny file-write* (subpath (param "WS_GIT_HOOK_1")))' in policy

        # No legacy single-key name should remain.
        assert "WS_GIT_HOOKS" not in policy

    def test_policy_does_not_allow_arbitrary_tmp_read_write(self, tmp_path):
        """The process sandbox must not allow symlink escapes into world temp dirs.

        Terminal command parsing may miss an existing workspace symlink such as
        ``.sandbox-tmp-link -> /tmp``. The macOS seatbelt policy is the
        enforcement backstop, so it must not grant arbitrary read/write access
        to temp directories outside the workspace.
        """
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        policy, _params = _build_seatbelt_policy(str(tmp_path))

        for temp_dir in ("/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp"):
            assert f'(allow file-read* file-test-existence file-write* (subpath "{temp_dir}"))' not in policy
            assert f'(allow file-read* file-write* (subpath "{temp_dir}"))' not in policy


# ---------------------------------------------------------------------------
# Test 6: V2 — execute_code must patch subprocess.Popen in code_execution_tool
# ---------------------------------------------------------------------------


class TestExecuteCodeCallsSandboxRunner:
    """V2: execute_code must patch subprocess.Popen inside code_execution_tool to use sandbox runner."""

    def test_execute_code_patches_popen_in_code_execution_tool(self, installed_wrappers):
        """When sandbox runner is available and snapshot active, wrapper must replace
        subprocess.Popen inside code_execution_tool with a sandboxed version for the
        duration of the original handler call, then restore the original.

        V1 bug: wrapper calls original_entry.handler directly with no Popen patch,
        so the child Python process is never sandboxed.
        """
        import tools.code_execution_tool as _cet
        import daemon.tools.desktop_tool_overrides as _dto

        wrappers, entries, tmp_path = installed_wrappers
        wrapper = wrappers["execute_code"]

        popen_seen_during_call = []
        original_popen = _cet.subprocess.Popen

        # Replace the mock entry handler with one that captures what Popen is
        # inside code_execution_tool at call time — this is the key assertion.
        original_entry = _dto.ORIGINAL_TOOLS.get("execute_code")
        assert original_entry is not None, "execute_code must be in ORIGINAL_TOOLS"

        saved_handler = original_entry.handler

        def capturing_handler(args, **kwargs):
            popen_seen_during_call.append(_cet.subprocess.Popen)
            return json.dumps({"result": "ok"})

        original_entry.handler = capturing_handler

        try:
            mock_runner = MagicMock()
            mock_runner.is_available.return_value = True

            with patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=mock_runner):
                result_json = wrapper({"language": "python", "code": "print('hello')"})

            # Handler must have been called
            assert len(popen_seen_during_call) == 1, "original handler should have been called once"

            # subprocess.Popen must have been replaced with the sandboxed version during the call
            assert popen_seen_during_call[0] is not original_popen, (
                "subprocess.Popen in code_execution_tool must be replaced with sandboxed version "
                "during the handler call (V1 bug: it was the original, meaning child process ran unsandboxed)"
            )

            # After the call, the original Popen must be restored
            assert _cet.subprocess.Popen is original_popen, (
                "subprocess.Popen must be restored to original after the handler call"
            )

            result = json.loads(result_json)
            assert result.get("result") == "ok"
        finally:
            original_entry.handler = saved_handler

    def test_execute_code_uses_subprocess_proxy_without_patching_global_popen(self, installed_wrappers):
        """The desktop execute_code wrapper must not mutate the stdlib subprocess module.

        The previous implementation assigned tools.code_execution_tool.subprocess.Popen.
        Because that object is the real stdlib subprocess module, it also changed
        subprocess.Popen globally and made sandbox_runner.popen recurse when it
        tried to spawn sandbox-exec.
        """
        import tools.code_execution_tool as _cet
        import daemon.tools.desktop_tool_overrides as _dto

        wrappers, _entries, _tmp_path = installed_wrappers
        wrapper = wrappers["execute_code"]

        original_global_popen = subprocess.Popen
        original_subprocess_module = _cet.subprocess
        seen = []

        original_entry = _dto.ORIGINAL_TOOLS.get("execute_code")
        assert original_entry is not None
        saved_handler = original_entry.handler

        def capturing_handler(args, **kwargs):
            seen.append({
                "module_is_proxy": _cet.subprocess is not original_subprocess_module,
                "global_popen_is_original": subprocess.Popen is original_global_popen,
                "create_no_window": getattr(_cet.subprocess, "CREATE_NO_WINDOW", None),
            })
            _cet.subprocess.Popen(["python"], stdout="stdout-sentinel", creationflags=77)
            return json.dumps({"result": "ok"})

        original_entry.handler = capturing_handler

        try:
            mock_runner = MagicMock()
            mock_runner.popen.return_value = MagicMock()

            with patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=mock_runner):
                result_json = wrapper({"language": "python", "code": "print('hello')"})

            assert json.loads(result_json).get("result") == "ok"
            assert seen == [{
                "module_is_proxy": True,
                "global_popen_is_original": True,
                "create_no_window": getattr(original_subprocess_module, "CREATE_NO_WINDOW", None),
            }]
            assert subprocess.Popen is original_global_popen
            assert _cet.subprocess is original_subprocess_module
            mock_runner.popen.assert_called_once()
            assert mock_runner.popen.call_args.kwargs["creationflags"] == 77
        finally:
            original_entry.handler = saved_handler

    def test_execute_code_uses_workspace_local_temp_and_socket_dir(
        self, installed_wrappers, monkeypatch
    ):
        """Desktop execute_code must not rely on world-writable temp directories.

        Removing broad /tmp permissions from the process sandbox only works if
        the desktop wrapper stages execute_code temp files and macOS RPC sockets
        under the active workspace before the original handler runs.
        """
        import tools.code_execution_tool as _cet
        import daemon.tools.desktop_tool_overrides as _dto

        wrappers, _entries, tmp_path = installed_wrappers
        wrapper = wrappers["execute_code"]

        monkeypatch.setenv("TMPDIR", "/tmp/original-tmpdir")
        monkeypatch.setenv("TMP", "/tmp/original-tmp")
        monkeypatch.setenv("TEMP", "/tmp/original-temp")
        monkeypatch.setenv("HERMES_EXECUTE_CODE_SOCKET_DIR", "/tmp/original-socket")
        monkeypatch.setattr(tempfile, "tempdir", "/tmp/cached-tempdir")

        original_entry = _dto.ORIGINAL_TOOLS.get("execute_code")
        assert original_entry is not None
        saved_handler = original_entry.handler
        seen = []

        def capturing_handler(args, **kwargs):
            seen.append({
                "tmpdir": os.environ.get("TMPDIR"),
                "tmp": os.environ.get("TMP"),
                "temp": os.environ.get("TEMP"),
                "socket_dir": os.environ.get("HERMES_EXECUTE_CODE_SOCKET_DIR"),
                "gettempdir": _cet.tempfile.gettempdir(),
            })
            return json.dumps({"result": "ok"})

        original_entry.handler = capturing_handler

        try:
            mock_runner = MagicMock()
            mock_runner.popen.return_value = MagicMock()

            with patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=mock_runner):
                result_json = wrapper({"language": "python", "code": "print('hello')"})

            scratch = str(tmp_path / ".hermes-sandbox")
            assert json.loads(result_json).get("result") == "ok"
            assert seen == [{
                "tmpdir": scratch,
                "tmp": scratch,
                "temp": scratch,
                "socket_dir": scratch,
                "gettempdir": scratch,
            }]
            assert os.environ["TMPDIR"] == "/tmp/original-tmpdir"
            assert os.environ["TMP"] == "/tmp/original-tmp"
            assert os.environ["TEMP"] == "/tmp/original-temp"
            assert os.environ["HERMES_EXECUTE_CODE_SOCKET_DIR"] == "/tmp/original-socket"
            assert tempfile.tempdir == "/tmp/cached-tempdir"
            assert (tmp_path / ".hermes-sandbox").is_dir()
        finally:
            original_entry.handler = saved_handler


class TestExecuteCodeSocketTempDir:
    def test_socket_temp_dir_prefers_env_override_on_macos(self, monkeypatch, tmp_path):
        """macOS execute_code RPC sockets can be redirected into workspace scratch."""
        import tools.code_execution_tool as _cet

        monkeypatch.setenv("HERMES_EXECUTE_CODE_SOCKET_DIR", str(tmp_path))

        with patch.object(_cet.sys, "platform", "darwin"):
            assert _cet._socket_temp_dir() == str(tmp_path)


class TestSandboxRunnerPopen:
    def test_policy_allows_explicit_executable_roots_without_write_access(self, tmp_path):
        """execute_code can run an interpreter outside workspace without widening writes."""
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        executable_root = tmp_path / "uv-python-runtime"
        policy, params = _build_seatbelt_policy(
            "/workspace",
            executable_roots=[str(executable_root)],
        )

        assert ("EXEC_ROOT_0", str(executable_root)) in params
        assert '(allow file-read* file-test-existence (subpath (param "EXEC_ROOT_0")))' in policy
        assert '(allow file-map-executable (subpath (param "EXEC_ROOT_0")))' in policy
        assert '(allow file-write* (subpath (param "EXEC_ROOT_0")' not in policy

    def test_runner_popen_uses_raw_popen_and_forwards_kwargs(self, monkeypatch, tmp_path):
        """runner.popen must bypass any temporary subprocess proxy and forward Popen kwargs."""
        import daemon.services.sandbox_runner as sr

        assert hasattr(sr, "_RAW_POPEN"), "sandbox_runner must keep an immutable raw Popen reference"

        calls = []

        def fake_raw_popen(argv, **kwargs):
            calls.append((argv, kwargs))
            return MagicMock()

        monkeypatch.setattr(sr, "_RAW_POPEN", fake_raw_popen)
        monkeypatch.setattr(
            sr, "_build_seatbelt_policy",
            lambda workspace_root, hermes_home=None: ("POLICY", [("WORKSPACE_ROOT", str(tmp_path))]),
        )

        snapshot = MagicMock()
        snapshot.workspace_root = tmp_path
        runner = sr.MacOSSandboxRunner()
        result = runner.popen(
            ["python", "script.py"],
            snapshot=snapshot,
            cwd=str(tmp_path),
            env={"A": "B"},
            stdin="stdin-sentinel",
            stdout="stdout-sentinel",
            stderr="stderr-sentinel",
            text=True,
            encoding="utf-8",
            errors="replace",
            preexec_fn="preexec-sentinel",
            creationflags=123,
            start_new_session=True,
        )

        assert result is not None
        assert len(calls) == 1
        argv, kwargs = calls[0]
        assert argv == [sr._SEATBELT_EXECUTABLE, "-p", "POLICY", f"-DWORKSPACE_ROOT={tmp_path}", "--", "python", "script.py"]
        assert kwargs["cwd"] == str(tmp_path)
        assert kwargs["env"] == {"A": "B"}
        assert kwargs["stdin"] == "stdin-sentinel"
        assert kwargs["stdout"] == "stdout-sentinel"
        assert kwargs["stderr"] == "stderr-sentinel"
        assert kwargs["text"] is True
        assert kwargs["encoding"] == "utf-8"
        assert kwargs["errors"] == "replace"
        assert kwargs["preexec_fn"] == "preexec-sentinel"
        assert kwargs["creationflags"] == 123
        assert kwargs["start_new_session"] is True

    def test_runner_popen_can_allow_resolved_command_executable_root(
        self, monkeypatch, tmp_path
    ):
        """execute_code Popen can grant read/map access to a venv symlink target."""
        import daemon.services.sandbox_runner as sr

        runtime_root = tmp_path / "uv-python-runtime"
        runtime_bin = runtime_root / "bin"
        runtime_bin.mkdir(parents=True)
        real_python = runtime_bin / "python3.12"
        real_python.write_text("#!python\n")

        workspace = tmp_path / "workspace"
        workspace_bin = workspace / ".venv" / "bin"
        workspace_bin.mkdir(parents=True)
        venv_python = workspace_bin / "python"
        venv_python.symlink_to(real_python)

        calls = []
        policies = []

        def fake_raw_popen(argv, **kwargs):
            calls.append(argv)
            return MagicMock()

        def fake_build_policy(workspace_root, hermes_home=None, executable_roots=None):
            policies.append({
                "workspace_root": workspace_root,
                "executable_roots": executable_roots,
            })
            return "POLICY", [("WORKSPACE_ROOT", workspace_root)]

        monkeypatch.setattr(sr, "_RAW_POPEN", fake_raw_popen)
        monkeypatch.setattr(sr, "_build_seatbelt_policy", fake_build_policy)

        snapshot = MagicMock()
        snapshot.workspace_root = workspace

        runner = sr.MacOSSandboxRunner()
        runner.popen([str(venv_python), "script.py"], snapshot=snapshot, allow_command_executable=True)

        assert calls == [[sr._SEATBELT_EXECUTABLE, "-p", "POLICY",
                          f"-DWORKSPACE_ROOT={workspace}", "--", str(real_python), "script.py"]]
        assert policies == [{
            "workspace_root": str(workspace),
            "executable_roots": [str(runtime_root)],
        }]
