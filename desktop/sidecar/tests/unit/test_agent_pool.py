"""Unit tests for AgentPool eviction, pinning, and tool callback mechanics."""
from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

from daemon.services.agent_pool import AgentPool, PooledAgent
from daemon.services.event_bus import EventBus


class _FakeAIAgent:
    """Minimal mock that satisfies the AgentPool contract."""

    def __init__(self, session_id: str = ""):
        self.session_id = session_id
        self._interrupted = False
        self.reasoning_config = None
        self.enabled_toolsets = None
        self.disabled_toolsets = None
        self.tools = []
        self.valid_tool_names = set()

    def interrupt(self):
        self._interrupted = True


@pytest.fixture
def pool():
    """Pool with _build_agent patched to use FakeAIAgent."""
    bus = EventBus()
    with patch.object(AgentPool, "_build_agent", side_effect=lambda sid: _FakeAIAgent(sid)):
        p = AgentPool(
            hermes_home=MagicMock(),
            event_bus=bus,
            session_db=MagicMock(),
        )
        yield p


def test_wait_for_mcp_discovery_uses_bounded_timeout(tmp_path, monkeypatch):
    import hermes_cli.mcp_startup as mcp_startup

    calls: list[float] = []
    monkeypatch.setattr(
        mcp_startup,
        "wait_for_mcp_discovery",
        lambda timeout=0.75: calls.append(timeout),
    )
    pool = AgentPool(tmp_path, EventBus(), session_db=MagicMock())

    pool._wait_for_mcp_discovery()

    assert calls == [0.75]


def test_refresh_tool_snapshots_rebuilds_cached_agent_tools(pool, monkeypatch):
    import model_tools

    calls = []
    tool_defs = [
        {
            "type": "function",
            "function": {
                "name": "mcp_time_now",
                "description": "Current time",
                "parameters": {"type": "object"},
            },
        }
    ]

    def fake_get_tool_definitions(**kwargs):
        calls.append(kwargs)
        return tool_defs

    monkeypatch.setattr(model_tools, "get_tool_definitions", fake_get_tool_definitions)
    entry = pool.get_or_create("s1")
    entry.agent.enabled_toolsets = ["mcp"]
    entry.agent.disabled_toolsets = ["terminal"]

    refreshed = pool.refresh_tool_snapshots()

    assert refreshed == 1
    assert entry.agent.tools == tool_defs
    assert entry.agent.valid_tool_names == {"mcp_time_now"}
    assert calls == [
        {
            "enabled_toolsets": ["mcp"],
            "disabled_toolsets": ["terminal"],
            "quiet_mode": True,
        }
    ]


class TestAgentPoolEviction:
    """LRU eviction and running-agent pinning."""

    def test_get_or_create_returns_same_agent(self, pool):
        e1 = pool.get_or_create("s1")
        e2 = pool.get_or_create("s1")
        assert e1 is e2
        assert e1.agent.session_id == "s1"

    def test_eviction_when_over_capacity(self, pool):
        pool.MAX_SIZE = 3

        for i in range(3):
            pool.get_or_create(f"sess-{i}")

        # Touch sess-0 so it's not the LRU
        time.sleep(0.01)
        pool.get_or_create("sess-0")

        # Add one more — should evict sess-1 (LRU)
        pool.get_or_create("sess-extra")

        with pool._lock:
            ids = set(pool._agents.keys())
            assert "sess-0" in ids
            assert "sess-1" not in ids

    def test_running_agent_not_evicted(self, pool):
        pool.MAX_SIZE = 2

        pool.get_or_create("sess-0")
        pool.get_or_create("sess-1")

        pool.mark_running("sess-0")
        pool.get_or_create("sess-extra")

        with pool._lock:
            ids = set(pool._agents.keys())
            assert "sess-0" in ids  # pinned
            assert "sess-1" not in ids  # evicted

    def test_mark_idle_clears_running(self, pool):
        e = pool.get_or_create("s1")
        pool.mark_running("s1")
        assert e.running is True
        pool.mark_idle("s1")
        assert e.running is False

    def test_interrupt_only_when_running(self, pool):
        e = pool.get_or_create("s1")
        pool.mark_running("s1")
        assert pool.interrupt("s1") is True
        assert e.agent._interrupted is True

    def test_interrupt_skips_idle_agent(self, pool):
        pool.get_or_create("s1")
        assert pool.interrupt("s1") is False

    def test_evict_only_idle(self, pool):
        pool.get_or_create("s1")
        pool.mark_running("s1")
        pool.evict("s1")

        with pool._lock:
            assert "s1" in pool._agents

        pool.mark_idle("s1")
        pool.evict("s1")

        with pool._lock:
            assert "s1" not in pool._agents

    def test_shutdown_interrupts_all(self, pool):
        pool.MAX_SIZE = 4
        for i in range(4):
            pool.get_or_create(f"s{i}")
            pool.mark_running(f"s{i}")

        pool.shutdown()

        with pool._lock:
            assert len(pool._agents) == 0

    def test_apply_runtime_updates_idle_agent_reasoning_config(self, pool):
        entry = pool.get_or_create("s1")

        applied = pool.apply_runtime("s1", {"reasoningEffort": "high"})

        assert applied is True
        assert entry.agent.reasoning_config == {"enabled": True, "effort": "high"}

    def test_apply_runtime_leaves_running_agent_for_next_turn(self, pool):
        entry = pool.get_or_create("s1")
        entry.agent.reasoning_config = {"enabled": True, "effort": "low"}
        pool.mark_running("s1")

        applied = pool.apply_runtime("s1", {"reasoningEffort": "none"})

        assert applied is False
        assert entry.agent.reasoning_config == {"enabled": True, "effort": "low"}


class TestToolCallbacks:
    """Tool event callbacks must match the signature run_agent actually calls them with.

    run_agent calls:
      tool_start_callback(tool_call_id, function_name, function_args)
      tool_complete_callback(tool_call_id, function_name, function_args, function_result)

    Callbacks must emit ui_messages rows with tool_id so the frontend can correlate
    tool.start and tool.complete events for the same tool call.
    """

    @pytest.fixture
    def pool_with_captured_emissions(self):
        """AgentPool whose _emit_ui_message is captured instead of hitting the DB."""
        bus = EventBus()
        with patch.object(AgentPool, "_build_agent", side_effect=lambda sid: _FakeAIAgent(sid)):
            p = AgentPool(
                hermes_home=MagicMock(),
                event_bus=bus,
                session_db=MagicMock(),
            )
        emitted = []

        def capture(sid, typ, payload, *, turn_id=None):
            emitted.append((sid, typ, payload, turn_id))

        p._emit_ui_message = capture
        return p, emitted

    def test_tool_start_cb_accepts_run_agent_signature(self, pool_with_captured_emissions):
        """Tracer bullet: tool_start_callback(tool_call_id, name, args) must not raise."""
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_tool_start_cb("sess_1")

        # run_agent calls with exactly these 3 positional args
        cb("call_abc123", "terminal", {"command": "ls /tmp"})

        assert len(emitted) == 1

    def test_tool_start_cb_emits_tool_id_from_run_agent(self, pool_with_captured_emissions):
        """tool.start event must carry tool_id matching the call_id from run_agent."""
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_tool_start_cb("sess_1")

        cb("call_abc123", "terminal", {"command": "ls /tmp"})

        _, typ, payload, _ = emitted[0]
        assert typ == "tool.start"
        assert payload["tool_id"] == "call_abc123"
        assert payload["name"] == "terminal"

    def test_tool_complete_cb_accepts_run_agent_signature(self, pool_with_captured_emissions):
        """tool_complete_callback(tool_call_id, name, args, result) must not raise."""
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_tool_complete_cb("sess_1")

        # run_agent calls with exactly these 4 positional args
        cb("call_abc123", "terminal", {"command": "ls /tmp"}, "file1\nfile2\n")

        assert len(emitted) == 1

    def test_tool_complete_cb_emits_tool_id(self, pool_with_captured_emissions):
        """tool.complete event must carry tool_id so frontend can match it to tool.start."""
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_tool_complete_cb("sess_1")

        cb("call_abc123", "terminal", {"command": "ls /tmp"}, "file1\nfile2\n")

        _, typ, payload, _ = emitted[0]
        assert typ == "tool.complete"
        assert payload["tool_id"] == "call_abc123"
        assert payload["name"] == "terminal"
        assert "summary" in payload

    def test_turn_bound_stream_delta_passes_explicit_turn_id(self, pool_with_captured_emissions):
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_stream_delta_cb("sess_1", turn_id="turn_a")

        cb("hello")

        assert emitted == [("sess_1", "message.delta", {"text": "hello"}, "turn_a")]

    def test_turn_bound_tool_generating_passes_explicit_turn_id(self, pool_with_captured_emissions):
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_tool_gen_cb("sess_1", turn_id="turn_a")

        cb("terminal", "tool_1")

        assert emitted == [
            (
                "sess_1",
                "tool.generating",
                {"name": "terminal", "text": "terminal", "tool_id": "tool_1"},
                "turn_a",
            )
        ]

    def test_turn_callbacks_include_subagent_progress_bridge(self, pool_with_captured_emissions):
        pool, _ = pool_with_captured_emissions

        callbacks = pool.make_turn_callbacks("sess_1", "turn_a")

        assert "tool_progress_callback" in callbacks

    def test_subagent_start_event_emits_desktop_payload(self, pool_with_captured_emissions):
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_tool_progress_cb("sess_1", turn_id="turn_a")

        cb(
            "subagent.start",
            preview="Inspect repo",
            subagent_id="sa-1",
            parent_id="sa-parent",
            depth=1,
            model="gpt-test",
            task_count=2,
            task_index=1,
            toolsets=["file", "terminal"],
        )

        assert emitted == [
            (
                "sess_1",
                "subagent.start",
                {
                    "session_id": "sess_1",
                    "subagent_id": "sa-1",
                    "parent_id": "sa-parent",
                    "model": "gpt-test",
                    "depth": 1,
                    "task_count": 2,
                    "task_index": 1,
                    "toolsets": ["file", "terminal"],
                    "goal": "Inspect repo",
                },
                "turn_a",
            )
        ]

    def test_subagent_complete_converts_file_lists_to_counts(self, pool_with_captured_emissions):
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_tool_progress_cb("sess_1", turn_id="turn_a")

        cb(
            "subagent.complete",
            subagent_id="sa-1",
            summary="done",
            duration_seconds=1.25,
            cost_usd=0.01,
            input_tokens=10,
            output_tokens=5,
            reasoning_tokens=2,
            api_calls=3,
            files_read=["a.py", "b.py"],
            files_written=["c.py"],
        )

        _, typ, payload, turn_id = emitted[0]
        assert typ == "subagent.complete"
        assert turn_id == "turn_a"
        assert payload["files_read"] == 2
        assert payload["files_written"] == 1
        assert payload["summary"] == "done"

    def test_subagent_failed_complete_emits_error_event(self, pool_with_captured_emissions):
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_tool_progress_cb("sess_1")

        cb(
            "subagent.complete",
            preview="timed out",
            subagent_id="sa-1",
            status="timeout",
            duration_seconds=30,
        )

        _, typ, payload, _ = emitted[0]
        assert typ == "subagent.error"
        assert payload["status"] == "timeout"
        assert payload["text"] == "timed out"

    def test_subagent_bridge_drops_unknown_or_idless_events(self, pool_with_captured_emissions):
        pool, emitted = pool_with_captured_emissions
        cb = pool._make_tool_progress_cb("sess_1")

        cb("subagent.start", preview="missing id")
        cb("subagent.thinking", subagent_id="sa-1", preview="thinking")

        assert emitted == []


class TestTurnBoundCallbackPersistence:
    """Turn-bound callbacks must attribute events without ambient turn context."""

    def test_stream_delta_persists_turn_id_without_ambient_context(self, tmp_path):
        from daemon.db.ui_messages import list_messages

        home = tmp_path / ".hermes"
        pool = AgentPool(home, EventBus(), session_db=MagicMock())
        cb = pool._make_stream_delta_cb("sess_1", turn_id="turn_a")

        cb("hello")

        rows = list_messages(home, "sess_1")
        assert rows[0]["type"] == "message.delta"
        assert rows[0]["turn_id"] == "turn_a"

    def test_tool_generating_persists_turn_id_without_ambient_context(self, tmp_path):
        from daemon.db.conversation_turns import list_turns
        from daemon.db.ui_messages import list_messages

        home = tmp_path / ".hermes"
        pool = AgentPool(home, EventBus(), session_db=MagicMock())
        cb = pool._make_tool_gen_cb("sess_1", turn_id="turn_a")

        cb("terminal", "tool_1")

        rows = list_messages(home, "sess_1")
        assert rows[0]["type"] == "tool.generating"
        assert rows[0]["turn_id"] == "turn_a"

        blocks = list_turns(home, "sess_1")[0]["assistant_blocks"]
        assert blocks[0]["type"] == "tool_call"
        assert blocks[0]["toolId"] == "tool_1"

    def test_callbacks_preserve_text_tool_text_order(self, tmp_path):
        from daemon.db.conversation_turns import list_turns
        from daemon.db.ui_messages import append

        home = tmp_path / ".hermes"
        sid = "sess_ordered"
        turn_id = "turn_ordered"
        pool = AgentPool(home, EventBus(), session_db=MagicMock())
        callbacks = pool.make_turn_callbacks(sid, turn_id)

        append(home, sid, "user", {"text": "inspect"}, turn_id=turn_id)
        callbacks["stream_delta_callback"]("first ")
        callbacks["tool_start_callback"]("tool_1", "terminal", {"command": "pwd"})
        callbacks["tool_complete_callback"]("tool_1", "terminal", {"command": "pwd"}, "done")
        callbacks["stream_delta_callback"]("middle ")
        callbacks["tool_start_callback"]("tool_2", "read_file", {"path": "README.md"})
        callbacks["tool_complete_callback"]("tool_2", "read_file", {"path": "README.md"}, "done")
        pool._emit_ui_message(sid, "message.complete", {"text": "first middle final"}, turn_id=turn_id)

        blocks = list_turns(home, sid)[0]["assistant_blocks"]
        assert [
            block["name"] if block["type"] == "tool_call" else block["type"]
            for block in blocks
        ] == ["text", "terminal", "text", "read_file", "text"]
        assert blocks[0]["content"] == "first "
        assert blocks[2]["content"] == "middle "
        assert blocks[4]["content"] == "final"

    def test_old_turn_bound_callback_does_not_use_new_active_turn(self, tmp_path):
        from daemon.db.ui_messages import list_messages

        home = tmp_path / ".hermes"
        sid = "sess_zombie"
        pool = AgentPool(home, EventBus(), session_db=MagicMock())
        pool._agents[sid] = PooledAgent(MagicMock(), sid)
        old_cb = pool._make_stream_delta_cb(sid, turn_id="turn_old")
        pool.mark_running(sid, "turn_new")

        old_cb("late")

        rows = list_messages(home, sid)
        assert rows[0]["turn_id"] == "turn_old"

    def test_unbound_callback_does_not_fall_back_to_active_turn(self, tmp_path):
        from daemon.db.conversation_turns import list_turns
        from daemon.db.ui_messages import list_messages

        home = tmp_path / ".hermes"
        sid = "sess_strict"
        pool = AgentPool(home, EventBus(), session_db=MagicMock())
        pool._agents[sid] = PooledAgent(MagicMock(), sid)
        pool.mark_running(sid, "turn_active")
        cb = pool._make_stream_delta_cb(sid)

        cb("missing attribution")

        rows = list_messages(home, sid)
        assert rows[0]["turn_id"] is None
        assert list_turns(home, sid) == []

    def test_payload_turn_id_is_still_respected(self, tmp_path):
        from daemon.db.ui_messages import list_messages

        home = tmp_path / ".hermes"
        sid = "sess_payload"
        pool = AgentPool(home, EventBus(), session_db=MagicMock())

        pool._emit_ui_message(
            sid,
            "message.delta",
            {"text": "payload-owned", "turn_id": "turn_payload"},
        )

        rows = list_messages(home, sid)
        assert rows[0]["turn_id"] == "turn_payload"

    def test_path_approval_payload_carries_explicit_turn_id(self):
        from tools.path_approval import (
            register_path_approval_notify,
            request_path_approval,
            reset_workspace_context,
            resolve_path_approval,
            set_workspace_context,
            unregister_path_approval_notify,
        )

        sid = "sess_path_turn"
        seen_payload = {}

        def notify(payload):
            seen_payload.update(payload)
            resolve_path_approval(sid, "deny")

        register_path_approval_notify(sid, notify)
        tokens = set_workspace_context("/workspace", sid, "turn_path")
        try:
            decision = request_path_approval(
                "/outside/file.txt",
                "read",
                sid,
                "read:/outside",
            )
        finally:
            reset_workspace_context(tokens)
            unregister_path_approval_notify(sid)

        assert decision == "deny"
        assert seen_payload["turn_id"] == "turn_path"

    def test_ask_mode_prompts_for_workspace_write_with_workspace_scoped_key(self):
        from tools.path_approval import (
            register_path_approval_notify,
            request_path_approval,
            reset_workspace_context,
            resolve_path_approval,
            set_workspace_context,
            unregister_path_approval_notify,
        )

        workspace = "/workspace"
        sid = "sess_path_ask"
        seen_payload = {}

        def notify(payload):
            seen_payload.update(payload)
            resolve_path_approval(sid, "deny")

        register_path_approval_notify(sid, notify)
        tokens = set_workspace_context(workspace, sid, "turn_ask", permission_mode="ask")
        try:
            decision = request_path_approval(
                "/workspace/src/app.py",
                "write",
                sid,
                "write:/workspace/src/app.py",
            )
        finally:
            reset_workspace_context(tokens)
            unregister_path_approval_notify(sid)

        assert decision == "deny"
        assert seen_payload["is_path_approval"] is True
        assert seen_payload["session_key"].startswith("ws:")
        assert seen_payload["session_key"].endswith(":write:/workspace/src/app.py")

    def test_auto_mode_allows_workspace_write_without_prompt(self):
        from tools.path_approval import (
            register_path_approval_notify,
            request_path_approval,
            reset_workspace_context,
            set_workspace_context,
            unregister_path_approval_notify,
        )

        sid = "sess_path_auto"
        calls = []

        register_path_approval_notify(sid, lambda payload: calls.append(payload))
        tokens = set_workspace_context("/workspace", sid, "turn_auto", permission_mode="auto")
        try:
            decision = request_path_approval(
                "/workspace/src/app.py",
                "write",
                sid,
                "write:/workspace/src/app.py",
            )
        finally:
            reset_workspace_context(tokens)
            unregister_path_approval_notify(sid)

        assert decision == "once"
        assert calls == []

    def test_full_mode_allows_outside_workspace_without_prompt(self):
        from tools.path_approval import (
            register_path_approval_notify,
            request_path_approval,
            reset_workspace_context,
            set_workspace_context,
            unregister_path_approval_notify,
        )

        sid = "sess_path_full"
        calls = []

        register_path_approval_notify(sid, lambda payload: calls.append(payload))
        tokens = set_workspace_context("/workspace", sid, "turn_full", permission_mode="full")
        try:
            decision = request_path_approval(
                "/outside/app.py",
                "write",
                sid,
                "write:/outside/app.py",
            )
        finally:
            reset_workspace_context(tokens)
            unregister_path_approval_notify(sid)

        assert decision == "once"
        assert calls == []

    def test_legacy_unhashed_path_approval_key_is_ignored(self, tmp_path):
        from tools.path_approval import (
            clear_session_approvals,
            preload_session_approvals,
            register_hermes_home,
            register_path_approval_notify,
            request_path_approval,
            reset_workspace_context,
            resolve_path_approval,
            set_workspace_context,
            unregister_path_approval_notify,
        )
        from daemon.db.ui_messages import save_session_approval

        home = tmp_path / ".hermes"
        sid = "sess_legacy_key"
        save_session_approval(home, sid, "write:/workspace/src/app.py")
        register_hermes_home(lambda: home)
        clear_session_approvals(sid)
        preload_session_approvals(sid)
        seen_payload = {}

        def notify(payload):
            seen_payload.update(payload)
            resolve_path_approval(sid, "deny")

        register_path_approval_notify(sid, notify)
        tokens = set_workspace_context("/workspace", sid, "turn_legacy", permission_mode="ask")
        try:
            decision = request_path_approval(
                "/workspace/src/app.py",
                "write",
                sid,
                "write:/workspace/src/app.py",
            )
        finally:
            reset_workspace_context(tokens)
            unregister_path_approval_notify(sid)
            clear_session_approvals(sid)

        assert decision == "deny"
        assert seen_payload["session_key"].startswith("ws:")
