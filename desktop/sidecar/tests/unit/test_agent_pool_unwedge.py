"""Regression: force_reset frees a wedged (stuck-running) session, and the
thread-guarded mark_idle prevents a zombie turn from clobbering a fresh one.

Covers the recovery path for a turn whose thread is blocked forever in a
stalled provider stream (so it never reaches mark_idle).
"""
from __future__ import annotations

import threading
from unittest.mock import MagicMock, patch

from daemon.services.agent_pool import AgentPool


class _FakeAgent:
    def __init__(self, sid: str = ""):
        self.sid = sid
        self.interrupted = False

    def interrupt(self):
        self.interrupted = True


def _build(sid):
    return (_FakeAgent(sid), "model-x", "prov-x")


def _make_pool() -> AgentPool:
    return AgentPool(hermes_home=MagicMock(), event_bus=MagicMock(), session_db=MagicMock())


def test_force_reset_frees_a_running_session():
    with patch.object(AgentPool, "_build_agent", side_effect=_build):
        pool = _make_pool()
        agent1 = pool.get_or_create("s1").agent
        pool.mark_running("s1")

        # A normal evict must NOT touch a running entry…
        pool.evict("s1")
        assert pool.is_running("s1") is True

        # …but force_reset frees it (interrupts the agent + drops the entry).
        assert pool.force_reset("s1") is True
        assert agent1.interrupted is True
        assert pool.is_running("s1") is False

        # The next turn builds a FRESH agent (the wedged one is abandoned).
        agent2 = pool.get_or_create("s1").agent
        assert agent2 is not agent1


def test_force_reset_on_unknown_session_is_noop():
    with patch.object(AgentPool, "_build_agent", side_effect=_build):
        pool = _make_pool()
        assert pool.force_reset("nope") is False


def test_mark_idle_thread_guard_ignores_zombie():
    with patch.object(AgentPool, "_build_agent", side_effect=_build):
        pool = _make_pool()
        entry = pool.get_or_create("s1")
        owner = threading.current_thread()
        entry.active_thread = owner
        entry.running = True

        # A different (zombie) thread must NOT idle this turn.
        zombie = threading.Thread(target=lambda: None)
        pool.mark_idle("s1", zombie)
        assert pool.is_running("s1") is True

        # The owning thread idles it normally.
        pool.mark_idle("s1", owner)
        assert pool.is_running("s1") is False
