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
