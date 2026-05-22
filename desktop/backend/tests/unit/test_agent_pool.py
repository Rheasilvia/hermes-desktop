"""Unit tests for AgentPool eviction and pinning mechanics.

Tests pool lifecycle without requiring a real AIAgent.
"""
from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import pytest

from desktop_backend.services.agent_pool import AgentPool, PooledAgent
from desktop_backend.services.event_bus import EventBus


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
