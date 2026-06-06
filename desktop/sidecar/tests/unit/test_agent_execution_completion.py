"""Regression: a turn that streams text via deltas but returns an empty
final_response must still publish message.complete.

Without it the desktop UI hangs forever showing "LLM in progress" because the
stop signal (message.complete) never arrives. Repro of the MiniMax-M3 hang where
the answer streamed visibly but the turn never finalized.
"""
from __future__ import annotations

from unittest.mock import MagicMock

from daemon.services.agent_execution_service import AgentExecutionService


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

    def clear_session(self, session_id):
        self.rows = []


class _FakeBus:
    def __init__(self):
        self.published = []

    def publish(self, session_id, seq, msg_type, payload):
        self.published.append(
            {"session_id": session_id, "seq": seq, "type": msg_type, "payload": payload}
        )


class _FakeAgent:
    model = "MiniMax-M3"
    provider = "minimax-cn"
    workspace_cwd = None
    context_compressor = None

    def __init__(self, ui, session_id):
        self._ui = ui
        self._sid = session_id

    def run_conversation(self, user_message, conversation_history):
        # Simulate the stream callback emitting deltas (visible text)…
        self._ui.append(self._sid, "message.delta", {"text": "我是 "})
        self._ui.append(self._sid, "message.delta", {"text": "MiniMax-M3"})
        # …but the provider path returns no aggregated final_response.
        return {"final_response": ""}


class _Entry:
    def __init__(self, agent):
        self.agent = agent
        self.running = False


class _FakePool:
    def __init__(self, agent):
        self._entry = _Entry(agent)
        self._turn_id = None

    def get_pooled_entry(self, sid):
        return self._entry

    def mark_running(self, sid, turn_id=None):
        self._turn_id = turn_id

    def set_thread(self, sid, t):
        ...

    def mark_idle(self, sid, thread=None):
        ...


class _FakeDB:
    def _execute_write(self, fn):
        return None


class _FakeState:
    def __init__(self):
        self._db = _FakeDB()

    def get_messages_as_conversation(self, sid):
        return []

    def get_session(self, sid):
        return None


def test_streamed_text_with_empty_final_response_still_completes(tmp_path):
    sid = "sess_test"
    ui = _FakeUIStore()
    bus = _FakeBus()
    agent = _FakeAgent(ui, sid)
    svc = AgentExecutionService(
        hermes_home=tmp_path,
        state=_FakeState(),
        ui_messages=ui,
        event_bus=bus,
        agent_pool=_FakePool(agent),
        session_service=MagicMock(),
    )

    turn_id = "turn_test"
    user_seq = ui.append(sid, "user", {"text": "你是什么模型？"}, turn_id=turn_id)
    svc._run_turn(sid, "你是什么模型？", user_seq, turn_id)

    completes = [e for e in bus.published if e["type"] == "message.complete"]
    assert completes, (
        "message.complete must be published even when final_response is empty "
        "but text was streamed — otherwise the UI hangs in 'streaming'."
    )
    # The finalized text must preserve the streamed answer (not vanish).
    assert completes[0]["payload"]["text"] == "我是 MiniMax-M3"
    assert completes[0]["payload"]["turn_id"] == turn_id


class _FakeAgentWithFinal(_FakeAgent):
    def run_conversation(self, user_message, conversation_history):
        self._ui.append(self._sid, "message.delta", {"text": "partial"})
        return {"final_response": "Final aggregated answer"}


class _FakeAgentInterrupted(_FakeAgent):
    def run_conversation(self, user_message, conversation_history):
        self._ui.append(self._sid, "message.delta", {"text": "half "})
        return {"final_response": "", "interrupted": True}


def _run(agent_cls, tmp_path):
    sid = "sess_test"
    ui = _FakeUIStore()
    bus = _FakeBus()
    svc = AgentExecutionService(
        hermes_home=tmp_path,
        state=_FakeState(),
        ui_messages=ui,
        event_bus=bus,
        agent_pool=_FakePool(agent_cls(ui, sid)),
        session_service=MagicMock(),
    )
    turn_id = "turn_test"
    user_seq = ui.append(sid, "user", {"text": "hi"}, turn_id=turn_id)
    svc._run_turn(sid, "hi", user_seq, turn_id)
    return bus


def test_non_empty_final_response_is_used_verbatim(tmp_path):
    bus = _run(_FakeAgentWithFinal, tmp_path)
    completes = [e for e in bus.published if e["type"] == "message.complete"]
    assert completes
    assert completes[0]["payload"]["text"] == "Final aggregated answer"


def test_interrupted_turn_does_not_fabricate_streamed_text(tmp_path):
    # An interrupted turn must not reconstruct/finalize streamed text — the
    # interrupt rollback path owns that case.
    bus = _run(_FakeAgentInterrupted, tmp_path)
    completes = [e for e in bus.published if e["type"] == "message.complete"]
    assert not completes, "interrupted turns must not emit a fabricated message.complete"


class _FakeAgentAuthFailed(_FakeAgent):
    def run_conversation(self, user_message, conversation_history):
        # Mirrors run_conversation's non-retryable 401 return: it does NOT raise,
        # it returns failed=True with an error string and no final_response/deltas.
        return {
            "final_response": None,
            "failed": True,
            "error": "Error code: 401 - {'error': {'message': 'Invalid Authentication'}}",
        }


def test_returned_auth_failure_surfaces_friendly_error(tmp_path):
    bus = _run(_FakeAgentAuthFailed, tmp_path)
    errors = [e for e in bus.published if e["type"] == "error"]
    completes = [e for e in bus.published if e["type"] == "message.complete"]
    assert errors, "a returned (non-raised) auth failure must publish an 'error' event"
    assert errors[0]["payload"]["code"] == "provider_auth"
    assert "authentication" in errors[0]["payload"]["message"].lower()
    # Must NOT also emit a message.complete for a failed turn.
    assert not completes


class _FakeAgentEmpty(_FakeAgent):
    def run_conversation(self, user_message, conversation_history):
        # No text, no deltas, not failed, not interrupted — must still finalize.
        return {"final_response": ""}


def test_empty_non_failed_turn_still_emits_terminal_signal(tmp_path):
    bus = _run(_FakeAgentEmpty, tmp_path)
    completes = [e for e in bus.published if e["type"] == "message.complete"]
    assert completes, "every non-failed turn must emit a terminal message.complete"


class _FakeAgentUsingCallbacks(_FakeAgent):
    def __init__(self, ui, session_id):
        super().__init__(ui, session_id)

        def stream_delta(text):
            self._ui.append(self._sid, "session.delta", {"text": text})

        def reasoning(text):
            self._ui.append(self._sid, "session.reasoning", {"text": text})

        def tool_gen(name, tool_id=None):
            self._ui.append(self._sid, "session.tool_gen", {"text": name})

        self.stream_delta_callback = stream_delta
        self.reasoning_callback = reasoning
        self.tool_start_callback = lambda tool_id, name, args=None: None
        self.tool_complete_callback = lambda tool_id, name, args=None, result="": None
        self.tool_gen_callback = tool_gen
        self.original_stream_delta_callback = self.stream_delta_callback
        self.original_tool_gen_callback = self.tool_gen_callback

    def run_conversation(self, user_message, conversation_history):
        self.stream_delta_callback("visible text")
        self.tool_gen_callback("terminal", "tool_1")
        return {"final_response": "visible text final"}


class _FakePoolWithTurnCallbacks(_FakePool):
    def __init__(self, agent, ui):
        super().__init__(agent)
        self._ui = ui

    def make_turn_callbacks(self, sid, turn_id):
        def stream_delta(text):
            self._ui.append(sid, "message.delta", {"text": text}, turn_id=turn_id)

        def reasoning(text):
            self._ui.append(sid, "reasoning.delta", {"text": text}, turn_id=turn_id)

        def tool_start(tool_id, name, args=None):
            self._ui.append(
                sid,
                "tool.start",
                {"tool_id": tool_id, "name": name, "args_preview": str(args) if args else ""},
                turn_id=turn_id,
            )

        def tool_complete(tool_id, name, args=None, result=""):
            self._ui.append(
                sid,
                "tool.complete",
                {"tool_id": tool_id, "name": name, "summary": result, "duration_s": 0},
                turn_id=turn_id,
            )

        def tool_gen(name, tool_id=None):
            payload = {"name": name, "text": name}
            if tool_id:
                payload["tool_id"] = tool_id
            self._ui.append(sid, "tool.generating", payload, turn_id=turn_id)

        return {
            "stream_delta_callback": stream_delta,
            "reasoning_callback": reasoning,
            "tool_start_callback": tool_start,
            "tool_complete_callback": tool_complete,
            "tool_gen_callback": tool_gen,
        }


def test_run_turn_installs_turn_bound_callbacks_and_restores_them(tmp_path):
    sid = "sess_test"
    ui = _FakeUIStore()
    bus = _FakeBus()
    agent = _FakeAgentUsingCallbacks(ui, sid)
    svc = AgentExecutionService(
        hermes_home=tmp_path,
        state=_FakeState(),
        ui_messages=ui,
        event_bus=bus,
        agent_pool=_FakePoolWithTurnCallbacks(agent, ui),
        session_service=MagicMock(),
    )
    turn_id = "turn_test"
    user_seq = ui.append(sid, "user", {"text": "hi"}, turn_id=turn_id)

    svc._run_turn(sid, "hi", user_seq, turn_id)

    assert agent.stream_delta_callback is agent.original_stream_delta_callback
    assert agent.tool_gen_callback is agent.original_tool_gen_callback
    delta = next(row for row in ui.rows if row["type"] == "message.delta")
    tool_generating = next(row for row in ui.rows if row["type"] == "tool.generating")
    assert delta["turn_id"] == turn_id
    assert tool_generating["turn_id"] == turn_id
