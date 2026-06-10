"""Tests: WorkspacePolicySnapshot is installed and cleared around _run_turn.

Verifies three properties:
1. The snapshot is set (non-None) during turn execution.
2. The snapshot is cleared (None) after _run_turn returns.
3. An invalid workspace_cwd does not crash the turn — snapshot is simply not installed.
"""
from __future__ import annotations

from unittest.mock import MagicMock

from daemon.services.agent_execution_service import AgentExecutionService
from daemon.services.workspace_policy import get_workspace_policy_snapshot


# ---------------------------------------------------------------------------
# Shared fakes (mirrors test_agent_execution_completion.py)
# ---------------------------------------------------------------------------


class _FakeUIStore:
    def __init__(self):
        self.rows = []
        self._seq = 0

    def append(self, session_id, msg_type, payload, turn_id=None):
        self._seq += 1
        payload_to_store = dict(payload)
        if turn_id:
            payload_to_store.setdefault("turn_id", turn_id)
        self.rows.append(
            {
                "session_id": session_id,
                "seq": self._seq,
                "type": msg_type,
                "payload": payload_to_store,
                "turn_id": turn_id,
            }
        )
        return self._seq

    def list_messages(self, session_id, since_seq=None):
        if since_seq is None:
            return list(self.rows)
        return [r for r in self.rows if r["seq"] > since_seq]


class _FakeBus:
    def __init__(self):
        self.published = []

    def publish(self, session_id, seq, msg_type, payload):
        self.published.append(
            {"session_id": session_id, "seq": seq, "type": msg_type, "payload": payload}
        )


class _FakeState:
    def __init__(self):
        self._db = _FakeDB()

    def get_messages_as_conversation(self, sid):
        return []

    def get_session(self, sid):
        return None


class _FakeDB:
    def _execute_write(self, fn):
        return None


class _FakeEntry:
    def __init__(self, agent, cwd=None):
        self.agent = agent
        self.running = False
        self.built_cwd = cwd


class _FakePool:
    def __init__(self, entry):
        self._entry = entry

    def get_pooled_entry(self, sid):
        return self._entry

    def mark_running(self, sid, turn_id=None):
        pass

    def set_thread(self, sid, t):
        pass

    def mark_idle(self, sid, thread=None):
        pass


# ---------------------------------------------------------------------------
# Test 1: snapshot is set (non-None) during turn execution
# ---------------------------------------------------------------------------


def test_snapshot_is_set_during_turn(tmp_path):
    """get_workspace_policy_snapshot() must return a non-None snapshot while _run_turn is active."""
    captured: list = []

    class _AgentCapture:
        model = "test-model"
        workspace_cwd = None
        context_compressor = None

        def run_conversation(self, user_message, conversation_history):
            # Capture the snapshot mid-turn
            captured.append(get_workspace_policy_snapshot())
            return {"final_response": "ok"}

    agent = _AgentCapture()
    sid = "sess-snap-set"
    ui = _FakeUIStore()
    bus = _FakeBus()
    entry = _FakeEntry(agent, cwd=str(tmp_path))

    svc = AgentExecutionService(
        hermes_home=tmp_path,
        state=_FakeState(),
        ui_messages=ui,
        event_bus=bus,
        agent_pool=_FakePool(entry),
        session_service=MagicMock(),
    )

    turn_id = "turn-snap-set"
    user_seq = ui.append(sid, "user", {"text": "hi"}, turn_id=turn_id)
    svc._run_turn(sid, "hi", user_seq, turn_id)

    assert len(captured) == 1, "run_conversation should have been called once"
    snapshot = captured[0]
    assert snapshot is not None, "snapshot must be set during turn execution"
    assert snapshot.session_id == sid
    assert snapshot.turn_id == turn_id


# ---------------------------------------------------------------------------
# Test 2: snapshot is cleared after turn returns
# ---------------------------------------------------------------------------


def test_snapshot_is_cleared_after_turn(tmp_path):
    """get_workspace_policy_snapshot() must return None after _run_turn completes."""

    class _AgentSimple:
        model = "test-model"
        workspace_cwd = None
        context_compressor = None

        def run_conversation(self, user_message, conversation_history):
            return {"final_response": "done"}

    agent = _AgentSimple()
    sid = "sess-snap-clear"
    ui = _FakeUIStore()
    bus = _FakeBus()
    entry = _FakeEntry(agent, cwd=str(tmp_path))

    svc = AgentExecutionService(
        hermes_home=tmp_path,
        state=_FakeState(),
        ui_messages=ui,
        event_bus=bus,
        agent_pool=_FakePool(entry),
        session_service=MagicMock(),
    )

    turn_id = "turn-snap-clear"
    user_seq = ui.append(sid, "user", {"text": "hi"}, turn_id=turn_id)
    svc._run_turn(sid, "hi", user_seq, turn_id)

    # After the turn, snapshot must be gone
    assert get_workspace_policy_snapshot() is None, (
        "WorkspacePolicySnapshot must be cleared after _run_turn returns"
    )
    # Agent attribute must also be cleaned up
    assert not hasattr(agent, "_desktop_workspace_policy_snapshot"), (
        "agent._desktop_workspace_policy_snapshot must be deleted after _run_turn"
    )


# ---------------------------------------------------------------------------
# Test 3: invalid workspace_cwd does not crash the turn
# ---------------------------------------------------------------------------


def test_invalid_cwd_does_not_crash_turn(tmp_path):
    """If workspace_cwd does not exist, the turn still completes without raising."""

    class _AgentSimple:
        model = "test-model"
        workspace_cwd = None
        context_compressor = None

        def run_conversation(self, user_message, conversation_history):
            return {"final_response": "survived"}

    agent = _AgentSimple()
    sid = "sess-bad-cwd"
    ui = _FakeUIStore()
    bus = _FakeBus()
    # Point built_cwd to a path that does not exist
    entry = _FakeEntry(agent, cwd=str(tmp_path / "does_not_exist"))

    svc = AgentExecutionService(
        hermes_home=tmp_path,
        state=_FakeState(),
        ui_messages=ui,
        event_bus=bus,
        agent_pool=_FakePool(entry),
        session_service=MagicMock(),
    )

    turn_id = "turn-bad-cwd"
    user_seq = ui.append(sid, "user", {"text": "hi"}, turn_id=turn_id)
    # Must not raise
    svc._run_turn(sid, "hi", user_seq, turn_id)

    # Turn should still have completed (message.complete published)
    completes = [e for e in bus.published if e["type"] == "message.complete"]
    assert completes, "turn must complete even when workspace_cwd is invalid"
    assert completes[0]["payload"]["text"] == "survived"
