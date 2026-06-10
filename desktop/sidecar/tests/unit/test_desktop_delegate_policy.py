"""Unit tests for delegate_task child-agent workspace policy inheritance.

Verifies that _install_delegate_patch() correctly propagates the parent agent's
_desktop_workspace_policy_snapshot onto child agents created by
tools.delegate_tool._build_child_agent.

All tests mock tools.delegate_tool to avoid importing the full Hermes agent stack.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_fake_delegate_tool_module():
    """Return a fake `tools.delegate_tool` module with a mock _build_child_agent."""
    mod = types.ModuleType("tools.delegate_tool")

    def _fake_build_child_agent(task_index, goal, context, toolsets, model,
                                max_iterations, task_count, parent_agent, **kwargs):
        """Fake _build_child_agent that returns a fresh MagicMock child agent."""
        child = MagicMock()
        child._task_index = task_index
        child._goal = goal
        return child

    mod._build_child_agent = _fake_build_child_agent
    return mod


def _make_fake_tools_package():
    """Return a bare `tools` package stub (needed so tools.delegate_tool is importable)."""
    pkg = types.ModuleType("tools")
    pkg.__path__ = []
    return pkg


def _build_snapshot(tmp_path):
    """Build a real WorkspacePolicySnapshot rooted at tmp_path."""
    from daemon.services.workspace_policy import build_workspace_policy_snapshot
    return build_workspace_policy_snapshot(
        session_id="sess-test",
        turn_id="turn-test",
        cwd=str(tmp_path),
        permission_mode="auto",
    )


def _fresh_overrides_module(fake_delegate_mod):
    """
    Import desktop_tool_overrides with clean state and tools.delegate_tool mocked.

    We can't clear _DELEGATE_PATCHED between tests by re-importing (because
    _install_delegate_patch only runs once in a live process), so each test
    that exercises the patching logic calls the inner wrapper directly after
    extracting it from the fake module, rather than relying on the global flag.
    """
    import importlib

    mod_name = "daemon.tools.desktop_tool_overrides"
    for key in list(sys.modules.keys()):
        if key == mod_name or key.startswith(mod_name + "."):
            del sys.modules[key]

    with patch.dict(sys.modules, {
        "tools": _make_fake_tools_package(),
        "tools.delegate_tool": fake_delegate_mod,
    }):
        overrides = importlib.import_module(mod_name)
    return overrides


# ---------------------------------------------------------------------------
# Test 1: child inherits snapshot from parent
# ---------------------------------------------------------------------------


class TestChildInheritsSnapshot:
    def test_child_gets_snapshot_and_cwds(self, tmp_path):
        """_policy_build_child_agent copies snapshot and sets workspace_cwd / session_cwd."""
        snap = _build_snapshot(tmp_path)

        fake_dt = _make_fake_delegate_tool_module()
        orig_build = fake_dt._build_child_agent

        # Capture a reference to the wrapper BEFORE patching resets _DELEGATE_PATCHED
        overrides = _fresh_overrides_module(fake_dt)
        # Reset the patched flag and re-run the patch to get the wrapper installed
        overrides._DELEGATE_PATCHED = False

        with patch.dict(sys.modules, {
            "tools": _make_fake_tools_package(),
            "tools.delegate_tool": fake_dt,
        }):
            overrides._install_delegate_patch()

        # tools.delegate_tool._build_child_agent should now be our wrapper
        wrapper = fake_dt._build_child_agent
        assert wrapper is not orig_build, "wrapper should replace _build_child_agent"

        parent_agent = MagicMock()
        parent_agent._desktop_workspace_policy_snapshot = snap

        child = wrapper(
            task_index=0,
            goal="do something",
            context="ctx",
            toolsets=[],
            model="claude-opus-4-5",
            max_iterations=10,
            task_count=1,
            parent_agent=parent_agent,
        )

        assert child._desktop_workspace_policy_snapshot is snap
        assert child.workspace_cwd == str(snap.cwd)
        assert child.session_cwd == str(snap.cwd)


# ---------------------------------------------------------------------------
# Test 2: no snapshot on parent → child created normally (no error)
# ---------------------------------------------------------------------------


class TestNoSnapshotOnParent:
    def test_child_created_without_snapshot_attribute(self, tmp_path):
        """When parent has no _desktop_workspace_policy_snapshot, child is returned as-is.

        We track whether the wrapper wrote the attribute by using a sentinel class
        that records attribute assignments.
        """
        fake_dt = _make_fake_delegate_tool_module()

        # Use a plain object as child so we can track attribute sets precisely
        class _ChildAgent:
            pass

        child_obj = _ChildAgent()
        orig_build = MagicMock(return_value=child_obj)
        fake_dt._build_child_agent = orig_build

        overrides = _fresh_overrides_module(fake_dt)
        overrides._DELEGATE_PATCHED = False

        with patch.dict(sys.modules, {
            "tools": _make_fake_tools_package(),
            "tools.delegate_tool": fake_dt,
        }):
            overrides._install_delegate_patch()

        wrapper = fake_dt._build_child_agent

        parent_agent = MagicMock(spec=[])  # spec=[] → no attributes by default
        # Confirm there is no _desktop_workspace_policy_snapshot on the parent
        assert not hasattr(parent_agent, "_desktop_workspace_policy_snapshot")

        child = wrapper(
            task_index=0,
            goal="do something",
            context="ctx",
            toolsets=[],
            model="claude-opus-4-5",
            max_iterations=10,
            task_count=1,
            parent_agent=parent_agent,
        )

        # Original _build_child_agent was called (wrapper delegated)
        orig_build.assert_called_once()

        # child is the same object we planted; the wrapper must not have set the attribute
        assert child is child_obj
        assert not hasattr(child, "_desktop_workspace_policy_snapshot")


# ---------------------------------------------------------------------------
# Test 3: patch is idempotent
# ---------------------------------------------------------------------------


class TestPatchIsIdempotent:
    def test_second_call_is_noop(self):
        """Calling _install_delegate_patch() twice does not double-wrap."""
        fake_dt = _make_fake_delegate_tool_module()
        orig_build = fake_dt._build_child_agent

        overrides = _fresh_overrides_module(fake_dt)
        overrides._DELEGATE_PATCHED = False

        with patch.dict(sys.modules, {
            "tools": _make_fake_tools_package(),
            "tools.delegate_tool": fake_dt,
        }):
            overrides._install_delegate_patch()

        first_wrapper = fake_dt._build_child_agent
        assert first_wrapper is not orig_build

        # Second call — _DELEGATE_PATCHED is True, so this is a no-op
        with patch.dict(sys.modules, {
            "tools": _make_fake_tools_package(),
            "tools.delegate_tool": fake_dt,
        }):
            overrides._install_delegate_patch()

        # The function on the module must still be the first wrapper, not re-wrapped
        assert fake_dt._build_child_agent is first_wrapper
        assert overrides._DELEGATE_PATCHED is True


# ---------------------------------------------------------------------------
# Test 4: wrapper does not bypass toolset intersection (upstream concern)
# ---------------------------------------------------------------------------


class TestWrapperDoesNotBypassIntersection:
    """The toolset capability intersection is enforced by the original _build_child_agent
    (upstream logic), not by our wrapper.  Our wrapper only copies the snapshot AFTER
    the original returns.  This test verifies that the original is always called exactly
    once with the arguments it was given, so the upstream intersection logic is never skipped.
    """

    def test_original_called_once_with_original_args(self, tmp_path):
        snap = _build_snapshot(tmp_path)

        fake_dt = _make_fake_delegate_tool_module()
        orig_build = MagicMock(return_value=MagicMock())
        fake_dt._build_child_agent = orig_build

        overrides = _fresh_overrides_module(fake_dt)
        overrides._DELEGATE_PATCHED = False

        with patch.dict(sys.modules, {
            "tools": _make_fake_tools_package(),
            "tools.delegate_tool": fake_dt,
        }):
            overrides._install_delegate_patch()

        wrapper = fake_dt._build_child_agent

        parent_agent = MagicMock()
        parent_agent._desktop_workspace_policy_snapshot = snap

        toolsets = ["read_only", "terminal"]
        wrapper(
            task_index=1,
            goal="delegate goal",
            context="ctx",
            toolsets=toolsets,
            model="claude-opus-4-5",
            max_iterations=5,
            task_count=2,
            parent_agent=parent_agent,
        )

        # The upstream original must be called once with the original arguments
        orig_build.assert_called_once_with(
            1, "delegate goal", "ctx", toolsets,
            "claude-opus-4-5", 5, 2, parent_agent,
        )


# ---------------------------------------------------------------------------
# Test 5: import failure of tools.delegate_tool is handled gracefully
# ---------------------------------------------------------------------------


class TestChildContextVarInWorkerThread:
    """V2: child run_conversation must have ContextVar set in its worker thread.

    V1 bug: only agent attribute is set; ContextVar is empty in the new thread.
    """

    def test_child_worker_thread_sees_workspace_snapshot(self, tmp_path):
        """Child's run_conversation, when called from a new thread, must see the policy snapshot via ContextVar.

        This test fails on V1 because the delegate patch only sets the agent attribute,
        not the ContextVar, so get_workspace_policy_snapshot() returns None in the worker thread.
        """
        import threading
        snap = _build_snapshot(tmp_path)

        fake_dt = _make_fake_delegate_tool_module()

        snapshot_seen_in_thread = []

        def fake_run_conversation(*args, **kwargs):
            from daemon.services.workspace_policy import get_workspace_policy_snapshot
            snapshot_seen_in_thread.append(get_workspace_policy_snapshot())

        child_mock = MagicMock()
        child_mock.run_conversation = fake_run_conversation

        orig_build = MagicMock(return_value=child_mock)
        fake_dt._build_child_agent = orig_build

        overrides = _fresh_overrides_module(fake_dt)
        overrides._DELEGATE_PATCHED = False

        with patch.dict(sys.modules, {
            "tools": _make_fake_tools_package(),
            "tools.delegate_tool": fake_dt,
        }):
            overrides._install_delegate_patch()

        wrapper = fake_dt._build_child_agent
        parent_agent = MagicMock()
        parent_agent._desktop_workspace_policy_snapshot = snap

        child = wrapper(
            task_index=0,
            goal="do something",
            context="ctx",
            toolsets=[],
            model="claude-opus-4-5",
            max_iterations=10,
            task_count=1,
            parent_agent=parent_agent,
        )

        # Simulate what delegate_tool does: run child.run_conversation in a worker thread
        t = threading.Thread(target=child.run_conversation, args=("goal",))
        t.start()
        t.join(timeout=5)

        assert len(snapshot_seen_in_thread) == 1, "run_conversation must have been called"
        assert snapshot_seen_in_thread[0] is not None, (
            "get_workspace_policy_snapshot() must return non-None inside the child worker thread. "
            "V1 bug: ContextVar is not set in the new thread."
        )
        assert snapshot_seen_in_thread[0] is snap


# ---------------------------------------------------------------------------
# Test 6: import failure of tools.delegate_tool is handled gracefully
# ---------------------------------------------------------------------------


class TestImportFailureHandledGracefully:
    def test_missing_delegate_tool_does_not_raise(self):
        """If tools.delegate_tool cannot be imported, _install_delegate_patch warns but does not raise."""
        import importlib

        mod_name = "daemon.tools.desktop_tool_overrides"
        for key in list(sys.modules.keys()):
            if key == mod_name or key.startswith(mod_name + "."):
                del sys.modules[key]

        overrides = importlib.import_module(mod_name)
        overrides._DELEGATE_PATCHED = False

        # Simulate import failure by ensuring tools.delegate_tool is NOT in sys.modules
        # and can't be imported (we patch the import mechanism)
        with patch.dict(sys.modules, {"tools": None, "tools.delegate_tool": None}):
            # None entries in sys.modules cause ImportError on import
            try:
                overrides._install_delegate_patch()
            except Exception as exc:
                raise AssertionError(
                    f"_install_delegate_patch should not raise on import failure, got: {exc}"
                ) from exc

        # _DELEGATE_PATCHED remains False when the import failed
        assert overrides._DELEGATE_PATCHED is False
