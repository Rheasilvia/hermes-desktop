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
        p._emit_ui_message = lambda sid, typ, payload: emitted.append((sid, typ, payload))
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

        _, typ, payload = emitted[0]
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

        _, typ, payload = emitted[0]
        assert typ == "tool.complete"
        assert payload["tool_id"] == "call_abc123"
        assert payload["name"] == "terminal"
        assert "summary" in payload
