"""Unit tests for file tool policy enforcement in desktop_tool_overrides.py.

Tests verify that read_file, write_file, patch, and search_files wrappers
enforce workspace containment via resolve_path() from workspace_policy.
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
# Tests 1-2: read_file
# ---------------------------------------------------------------------------


class TestReadFileWrapper:
    def test_read_file_inside_workspace_calls_original_with_canonical_path(
        self, installed_wrappers
    ):
        """read_file with a path inside the workspace should call original handler."""
        wrappers, entries, tmp_path = installed_wrappers
        inner_file = tmp_path / "subdir" / "notes.txt"
        inner_file.parent.mkdir(parents=True, exist_ok=True)
        inner_file.write_text("hello")

        wrapper = wrappers["read_file"]
        result_json = wrapper({"path": str(inner_file)})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        entries["read_file"].handler.assert_called_once()
        called_args = entries["read_file"].handler.call_args[0][0]
        # The wrapper must have rewritten path to canonical
        assert called_args["path"] == str(inner_file.resolve())

    def test_read_file_outside_workspace_is_denied(self, installed_wrappers):
        """read_file with path ../../outside.txt must return WORKSPACE_VIOLATION."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["read_file"]
        result_json = wrapper({"path": "../../outside.txt"})
        result = json.loads(result_json)

        assert result.get("code") == "WORKSPACE_VIOLATION"
        assert "denied" in result.get("error", "").lower()
        entries["read_file"].handler.assert_not_called()


# ---------------------------------------------------------------------------
# Tests 3-4: write_file
# ---------------------------------------------------------------------------


class TestWriteFileWrapper:
    def test_write_file_inside_workspace_calls_original(self, installed_wrappers):
        """write_file with a path inside the workspace should call original handler."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["write_file"]
        result_json = wrapper({"path": str(tmp_path / "output.txt"), "content": "data"})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        entries["write_file"].handler.assert_called_once()

    def test_write_file_outside_workspace_is_denied(self, installed_wrappers):
        """write_file with path outside workspace must return WORKSPACE_VIOLATION."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["write_file"]
        result_json = wrapper({"path": "/tmp/evil_write.txt", "content": "bad"})
        result = json.loads(result_json)

        assert result.get("code") == "WORKSPACE_VIOLATION"
        entries["write_file"].handler.assert_not_called()

    def test_write_file_through_dangling_symlink_escape_is_denied(self, installed_wrappers):
        """write_file targeting an in-workspace symlink to a non-existing OUTSIDE
        target must be denied — the handler's open() would otherwise follow the
        link and write outside the workspace."""
        import os
        wrappers, entries, tmp_path = installed_wrappers
        outside_target = tmp_path.parent / "escape_via_symlink.txt"
        assert not outside_target.exists()
        link = tmp_path / "link.txt"
        os.symlink(str(outside_target), str(link))  # dangling symlink inside workspace

        wrapper = wrappers["write_file"]
        result = json.loads(wrapper({"path": str(link), "content": "bad"}))

        assert result.get("code") == "WORKSPACE_VIOLATION"
        entries["write_file"].handler.assert_not_called()
        assert not outside_target.exists()

    def test_write_file_read_only_sandbox_is_pre_denied(self, installed_wrappers):
        """Desktop read-only sandbox mode rejects mutating file tools before the handler."""
        from daemon.services.workspace_policy import (
            build_workspace_policy_snapshot,
            reset_workspace_policy_snapshot,
            set_workspace_policy_snapshot,
        )

        wrappers, entries, tmp_path = installed_wrappers
        snap = build_workspace_policy_snapshot(
            "sess2", "turn2", str(tmp_path), "auto", sandbox_mode="read-only"
        )
        token = set_workspace_policy_snapshot(snap)
        try:
            result = json.loads(wrappers["write_file"]({
                "path": str(tmp_path / "output.txt"),
                "content": "data",
            }))
        finally:
            reset_workspace_policy_snapshot(token)

        assert result.get("code") == "SANDBOX_READ_ONLY"
        entries["write_file"].handler.assert_not_called()


# ---------------------------------------------------------------------------
# Tests 5-6: search_files
# ---------------------------------------------------------------------------


class TestSearchFilesWrapper:
    def test_search_files_inside_workspace_calls_original_with_canonical_path(
        self, installed_wrappers
    ):
        """search_files with a path inside the workspace should call original."""
        wrappers, entries, tmp_path = installed_wrappers
        sub = tmp_path / "src"
        sub.mkdir()

        wrapper = wrappers["search_files"]
        result_json = wrapper({"path": str(sub), "pattern": "*.py"})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        entries["search_files"].handler.assert_called_once()
        called_args = entries["search_files"].handler.call_args[0][0]
        assert called_args["path"] == str(sub.resolve())

    def test_search_files_outside_workspace_is_denied(self, installed_wrappers):
        """search_files with path outside workspace must return WORKSPACE_VIOLATION."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["search_files"]
        result_json = wrapper({"path": "/etc", "pattern": "passwd"})
        result = json.loads(result_json)

        assert result.get("code") == "WORKSPACE_VIOLATION"
        entries["search_files"].handler.assert_not_called()

    def test_search_files_defaults_path_to_workspace_root(self, installed_wrappers):
        """When no 'path' key is provided, should default to workspace root (cwd)."""
        wrappers, entries, tmp_path = installed_wrappers
        entries["search_files"].handler.return_value = "[]"

        wrapper = wrappers["search_files"]
        result = wrapper({"pattern": "*.py"})

        # Original should be called — no path means default "." resolves to workspace root
        assert entries["search_files"].handler.called
        called_args = entries["search_files"].handler.call_args[0][0]
        assert "path" in called_args
        # The resolved path should be the workspace root (tmp_path)
        assert str(tmp_path) in called_args["path"] or called_args["path"] == str(tmp_path)


# ---------------------------------------------------------------------------
# Tests 7-10: patch
# ---------------------------------------------------------------------------


class TestPatchWrapper:
    def test_patch_replace_mode_inside_workspace_calls_original(
        self, installed_wrappers
    ):
        """patch in replace mode with a path inside workspace should call original."""
        wrappers, entries, tmp_path = installed_wrappers
        target_file = tmp_path / "main.py"
        target_file.write_text("x = 1\n")

        wrapper = wrappers["patch"]
        result_json = wrapper({"path": str(target_file), "content": "x = 2\n"})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        entries["patch"].handler.assert_called_once()

    def test_patch_replace_mode_outside_workspace_is_denied(
        self, installed_wrappers
    ):
        """patch in replace mode with path outside workspace must return WORKSPACE_VIOLATION."""
        wrappers, entries, tmp_path = installed_wrappers

        wrapper = wrappers["patch"]
        result_json = wrapper({"path": "/etc/hosts", "content": "evil"})
        result = json.loads(result_json)

        assert result.get("code") == "WORKSPACE_VIOLATION"
        entries["patch"].handler.assert_not_called()

    def test_patch_patch_mode_with_escaping_file_is_denied(
        self, installed_wrappers
    ):
        """patch mode diff that touches a file outside workspace must be denied."""
        wrappers, entries, tmp_path = installed_wrappers

        # Construct a minimal unified diff: one file inside, one escaping
        diff_text = (
            "--- a/README.md\n"
            "+++ b/README.md\n"
            "@@ -1,1 +1,1 @@\n"
            "-old line\n"
            "+new line\n"
            "--- a/../../../outside.txt\n"
            "+++ b/../../../outside.txt\n"
            "@@ -1,1 +1,1 @@\n"
            "-secret\n"
            "+hacked\n"
        )

        wrapper = wrappers["patch"]
        result_json = wrapper({"patch": diff_text})
        result = json.loads(result_json)

        assert result.get("code") == "WORKSPACE_VIOLATION"
        entries["patch"].handler.assert_not_called()

    def test_patch_patch_mode_with_all_files_inside_workspace_calls_original(
        self, installed_wrappers
    ):
        """patch mode diff where all touched files are inside workspace should call original."""
        wrappers, entries, tmp_path = installed_wrappers
        # Create the files so resolve_path can confirm they exist
        (tmp_path / "src").mkdir(exist_ok=True)
        (tmp_path / "src" / "app.py").write_text("x = 1\n")
        (tmp_path / "src" / "utils.py").write_text("y = 2\n")

        diff_text = (
            "--- a/src/app.py\n"
            "+++ b/src/app.py\n"
            "@@ -1,1 +1,1 @@\n"
            "-x = 1\n"
            "+x = 10\n"
            "--- a/src/utils.py\n"
            "+++ b/src/utils.py\n"
            "@@ -1,1 +1,1 @@\n"
            "-y = 2\n"
            "+y = 20\n"
        )

        wrapper = wrappers["patch"]
        result_json = wrapper({"patch": diff_text})
        result = json.loads(result_json)

        assert result.get("result") == "ok"
        entries["patch"].handler.assert_called_once()

    def test_patch_read_only_sandbox_is_pre_denied(self, installed_wrappers):
        from daemon.services.workspace_policy import (
            build_workspace_policy_snapshot,
            reset_workspace_policy_snapshot,
            set_workspace_policy_snapshot,
        )

        wrappers, entries, tmp_path = installed_wrappers
        target_file = tmp_path / "main.py"
        target_file.write_text("x = 1\n")
        snap = build_workspace_policy_snapshot(
            "sess2", "turn2", str(tmp_path), "auto", sandbox_mode="read-only"
        )
        token = set_workspace_policy_snapshot(snap)
        try:
            result = json.loads(wrappers["patch"]({
                "path": str(target_file),
                "content": "x = 2\n",
            }))
        finally:
            reset_workspace_policy_snapshot(token)

        assert result.get("code") == "SANDBOX_READ_ONLY"
        entries["patch"].handler.assert_not_called()


# ---------------------------------------------------------------------------
# Tests 11-15: V4A patch headers (V2 red tests)
# ---------------------------------------------------------------------------


class TestPatchV4AHeaders:
    """V2: patch wrapper must parse V4A-format headers and reject unknown non-empty formats."""

    def test_patch_v4a_add_file_outside_workspace_denied(self, installed_wrappers):
        """V4A '*** Add File:' header with outside path must be denied."""
        wrappers, entries, tmp_path = installed_wrappers
        patch_text = "*** Add File: ../outside.txt\n<some content>\n"
        result = json.loads(wrappers["patch"]({"patch": patch_text}))
        assert result.get("code") == "WORKSPACE_VIOLATION", f"got: {result}"
        entries["patch"].handler.assert_not_called()

    def test_patch_v4a_update_file_outside_workspace_denied(self, installed_wrappers):
        """V4A '*** Update File:' header with outside path must be denied."""
        wrappers, entries, tmp_path = installed_wrappers
        patch_text = "*** Update File: ../outside.txt\n<some content>\n"
        result = json.loads(wrappers["patch"]({"patch": patch_text}))
        assert result.get("code") == "WORKSPACE_VIOLATION", f"got: {result}"
        entries["patch"].handler.assert_not_called()

    def test_patch_v4a_delete_file_outside_workspace_denied(self, installed_wrappers):
        """V4A '*** Delete File:' header with outside path must be denied."""
        wrappers, entries, tmp_path = installed_wrappers
        patch_text = "*** Delete File: ../outside.txt\n"
        result = json.loads(wrappers["patch"]({"patch": patch_text}))
        assert result.get("code") == "WORKSPACE_VIOLATION", f"got: {result}"
        entries["patch"].handler.assert_not_called()

    def test_patch_v4a_move_to_outside_workspace_denied(self, installed_wrappers):
        """V4A '*** Move to:' header with outside path must be denied."""
        wrappers, entries, tmp_path = installed_wrappers
        patch_text = "*** Move to: ../outside.txt\n"
        result = json.loads(wrappers["patch"]({"patch": patch_text}))
        assert result.get("code") == "WORKSPACE_VIOLATION", f"got: {result}"
        entries["patch"].handler.assert_not_called()

    def test_patch_unknown_nonempty_format_denied(self, installed_wrappers):
        """Non-empty patch text with no recognized headers must be denied (not passed through).

        V1 bug: unknown format falls through to original handler unchecked.
        """
        wrappers, entries, tmp_path = installed_wrappers
        patch_text = "SOME_CUSTOM_FORMAT: file.txt\ncontent here\n"
        result = json.loads(wrappers["patch"]({"patch": patch_text}))
        assert result.get("code") == "WORKSPACE_VIOLATION", (
            f"Unknown non-empty patch format must be denied, got: {result}"
        )
        entries["patch"].handler.assert_not_called()


# ---------------------------------------------------------------------------
# Tests: file-tool I/O runs under the macOS sandbox proxy (#4b)
# ---------------------------------------------------------------------------


class TestFileToolSandboxing:
    """#4b: read/write/patch file I/O must run with the local-subprocess sandbox
    proxy installed, so the kernel re-checks paths at the shell command's open()
    (closing the TOCTOU window between L1 resolve_path and the actual open), then
    restore the originals afterward. When no macOS sandbox runner is available
    (Linux/Windows desktop) or the backend is non-local (docker/ssh), fall back
    to a direct call — L1 resolve_path remains the containment boundary.
    """

    def _assert_runs_under_proxy(self, wrapper, entry, args):
        """Drive *wrapper* with a capturing handler and assert the local +
        process-registry subprocess modules are proxied during the call,
        the runner is exercised, and the originals are restored afterward."""
        import subprocess
        import tools.environments.local as local_env
        import tools.process_registry as process_registry

        original_local = local_env.subprocess.Popen
        original_registry = process_registry.subprocess.Popen
        original_global = subprocess.Popen
        seen = []

        def handler(_a, **_kw):
            seen.append({
                "local_is_proxy": local_env.subprocess.Popen is not original_local,
                "registry_is_proxy": process_registry.subprocess.Popen is not original_registry,
                "global_is_original": subprocess.Popen is original_global,
            })
            # Exercise the proxied Popen so the sandbox runner is actually invoked.
            local_env.subprocess.Popen(["python"], stdout="local-stdout")
            return json.dumps({"result": "ok"})

        entry.handler = MagicMock(side_effect=handler)
        mock_runner = MagicMock()
        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=mock_runner),
        ):
            result_json = wrapper(args)

        assert json.loads(result_json).get("result") == "ok"
        assert seen == [{
            "local_is_proxy": True,
            "registry_is_proxy": True,
            "global_is_original": True,
        }]
        assert mock_runner.popen.call_count >= 1
        # Module attributes restored after the call.
        assert local_env.subprocess.Popen is original_local
        assert process_registry.subprocess.Popen is original_registry
        assert subprocess.Popen is original_global

    def test_read_file_io_runs_under_sandbox_proxy(self, installed_wrappers):
        wrappers, entries, tmp_path = installed_wrappers
        inner = tmp_path / "notes.txt"
        inner.write_text("hi")
        self._assert_runs_under_proxy(
            wrappers["read_file"], entries["read_file"], {"path": str(inner)})

    def test_write_file_io_runs_under_sandbox_proxy(self, installed_wrappers):
        wrappers, entries, tmp_path = installed_wrappers
        self._assert_runs_under_proxy(
            wrappers["write_file"], entries["write_file"],
            {"path": str(tmp_path / "out.txt"), "content": "x"})

    def test_patch_io_runs_under_sandbox_proxy(self, installed_wrappers):
        wrappers, entries, tmp_path = installed_wrappers
        target = tmp_path / "main.py"
        target.write_text("x = 1\n")
        self._assert_runs_under_proxy(
            wrappers["patch"], entries["patch"],
            {"path": str(target), "old_string": "x = 1", "new_string": "x = 2"})

    def test_l1_denial_short_circuits_before_sandbox(self, installed_wrappers):
        """Outside-workspace path denied at L1 — the sandbox runner is never consulted."""
        wrappers, entries, tmp_path = installed_wrappers
        with patch("daemon.services.sandbox_runner.get_sandbox_runner") as get_runner:
            result = json.loads(wrappers["read_file"]({"path": "/etc/passwd"}))
        assert result.get("code") == "WORKSPACE_VIOLATION"
        entries["read_file"].handler.assert_not_called()
        get_runner.assert_not_called()

    def test_no_sandbox_runner_falls_back_to_direct_call(self, installed_wrappers):
        """No macOS runner ⇒ file I/O runs directly (L1 stays the boundary; file
        tools do NOT fail closed, unlike terminal which executes arbitrary commands)."""
        import tools.environments.local as local_env
        wrappers, entries, tmp_path = installed_wrappers
        inner = tmp_path / "notes.txt"
        inner.write_text("hi")
        original_local = local_env.subprocess.Popen
        seen = []

        def handler(_a, **_kw):
            seen.append(local_env.subprocess.Popen is original_local)  # original, not a proxy
            return json.dumps({"result": "ok"})

        entries["read_file"].handler = MagicMock(side_effect=handler)
        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "local"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=None),
        ):
            result = json.loads(wrappers["read_file"]({"path": str(inner)}))
        assert result.get("result") == "ok"
        assert seen == [True]

    def test_non_local_backend_skips_local_proxy(self, installed_wrappers):
        """A non-local backend (docker/ssh) isolates itself; the local-subprocess
        proxy must NOT be installed (it would wrongly sandbox the host helper)."""
        import tools.environments.local as local_env
        wrappers, entries, tmp_path = installed_wrappers
        inner = tmp_path / "notes.txt"
        inner.write_text("hi")
        original_local = local_env.subprocess.Popen
        seen = []

        def handler(_a, **_kw):
            seen.append(local_env.subprocess.Popen is original_local)
            return json.dumps({"result": "ok"})

        entries["read_file"].handler = MagicMock(side_effect=handler)
        with (
            patch("tools.terminal_tool._get_env_config", return_value={"env_type": "docker"}),
            patch("daemon.services.sandbox_runner.get_sandbox_runner", return_value=MagicMock()),
        ):
            result = json.loads(wrappers["read_file"]({"path": str(inner)}))
        assert result.get("result") == "ok"
        assert seen == [True]
