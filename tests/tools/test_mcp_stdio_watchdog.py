"""Contract tests for the direct POSIX stdio MCP child watchdog."""

import os
import sys

import pytest

from tools import mcp_stdio_watchdog, mcp_tool


def test_is_orphaned_is_false_while_direct_parent_is_unchanged():
    original_ppid = 1234

    assert mcp_stdio_watchdog._is_orphaned(
        original_ppid,
        getppid=lambda: original_ppid,
    ) is False


def test_is_orphaned_is_true_after_direct_parent_changes():
    assert mcp_stdio_watchdog._is_orphaned(
        1234,
        getppid=lambda: 5678,
    ) is True


def test_frozen_parent_identity_survives_bootloader_intermediary():
    class Parent:
        def is_running(self):
            return True

        def create_time(self):
            return 42.5

    assert mcp_stdio_watchdog._is_orphaned(
        1234,
        getppid=lambda: 9999,
        parent_create_time=42.5,
        process_factory=lambda pid: Parent(),
    ) is False


def test_frozen_parent_identity_rejects_pid_reuse():
    class ReusedPid:
        def is_running(self):
            return True

        def create_time(self):
            return 99.0

    assert mcp_stdio_watchdog._is_orphaned(
        1234,
        parent_create_time=42.5,
        process_factory=lambda pid: ReusedPid(),
    ) is True


@pytest.mark.skipif(os.name != "posix", reason="watchdog wrapping is POSIX-only")
def test_wrap_command_uses_stable_parent_pid_and_preserves_command_tail():
    parent_pid = os.getpid()
    command = "/opt/hermes/bin/mcp-server"
    command_args = ["--label", "value with spaces", "--", "literal-tail"]

    wrapped_command, wrapped_args = mcp_tool._wrap_command_with_watchdog(
        command,
        command_args,
    )

    assert wrapped_command == sys.executable
    assert wrapped_args == [
        os.path.join(os.path.dirname(mcp_tool.__file__), "mcp_stdio_watchdog.py"),
        "--ppid",
        str(parent_pid),
        "--",
        command,
        *command_args,
    ]
    assert "--create-time" not in wrapped_args


@pytest.mark.skipif(os.name != "posix", reason="watchdog wrapping is POSIX-only")
def test_frozen_studio_runtime_dispatches_bundled_watchdog(monkeypatch):
    monkeypatch.setattr(mcp_tool.sys, "frozen", True, raising=False)
    monkeypatch.setattr(
        mcp_tool.sys,
        "_hermes_mcp_watchdog_entrypoint",
        "--hermes-mcp-stdio-watchdog",
        raising=False,
    )

    wrapped_command, wrapped_args = mcp_tool._wrap_command_with_watchdog(
        "/opt/hermes/bin/mcp-server",
        ["--stdio"],
    )

    assert wrapped_command == sys.executable
    assert wrapped_args[:3] == [
        "--hermes-mcp-stdio-watchdog",
        "--ppid",
        str(os.getpid()),
    ]
    assert wrapped_args[3] == "--parent-create-time"
    assert float(wrapped_args[4]) > 0
    assert wrapped_args[5:] == [
        "--",
        "/opt/hermes/bin/mcp-server",
        "--stdio",
    ]


@pytest.mark.skipif(os.name != "posix", reason="watchdog wrapping is POSIX-only")
def test_unknown_frozen_runtime_safely_skips_python_script_wrapper(monkeypatch, caplog):
    monkeypatch.setattr(mcp_tool.sys, "frozen", True, raising=False)
    monkeypatch.delattr(
        mcp_tool.sys,
        "_hermes_mcp_watchdog_entrypoint",
        raising=False,
    )
    command = "/opt/hermes/bin/mcp-server"
    args = ["--stdio"]

    assert mcp_tool._wrap_command_with_watchdog(command, args) == (command, args)
    assert "watchdog unavailable in this frozen runtime" in caplog.text
