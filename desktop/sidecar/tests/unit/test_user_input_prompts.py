from __future__ import annotations

import threading
import time

import pytest

from daemon.db import user_input_prompts as prompt_repo
from daemon.db.conversation_turns import list_turns
from daemon.db.ui_messages import append, list_messages
from daemon.db.user_input_prompts import create_request, get_request, list_pending
from daemon.services.session_service import SessionService
from daemon.services.user_input_prompt_service import UserInputPromptService


class _Bus:
    def __init__(self) -> None:
        self.events = []

    def publish(self, session_id, seq, msg_type, payload):
        self.events.append({
            "session_id": session_id,
            "seq": seq,
            "type": msg_type,
            "payload": payload,
        })


def _questions():
    return [
        {
            "id": "scope",
            "header": "Scope",
            "question": "Which scope should I use?",
            "options": [
                {"label": "Narrow", "description": "Touch only this panel."},
                {"label": "Broad", "description": "Include recovery plumbing."},
            ],
        }
    ]


def test_request_user_input_waits_until_answer_and_marks_turn_awaiting(tmp_path):
    home = tmp_path / ".hermes"
    sid = "sess-user-input"
    turn_id = "turn_user_input"
    append(home, sid, "user", {"text": "plan this"}, turn_id=turn_id)

    bus = _Bus()
    svc = UserInputPromptService(home, bus)
    result: dict = {}

    thread = threading.Thread(
        target=lambda: result.update({
            "answers": svc.request_and_wait(
                session_id=sid,
                turn_id=turn_id,
                questions=_questions(),
            )
        }),
        daemon=True,
    )
    thread.start()

    deadline = time.time() + 2
    while time.time() < deadline and not bus.events:
        time.sleep(0.01)

    assert thread.is_alive(), "request_user_input must not auto-resolve on a timer"
    assert bus.events[0]["type"] == "user_input.request"
    request_id = bus.events[0]["payload"]["request_id"]
    assert list_turns(home, sid)[0]["status"] == "awaiting_user"

    answers = {"scope": {"answers": ["Broad"]}}
    prompt = svc.answer(session_id=sid, request_id=request_id, answers=answers)
    assert prompt is not None
    assert svc.wake_waiter(request_id, prompt["answers"])
    thread.join(timeout=2)

    assert not thread.is_alive()
    assert result["answers"] == answers
    assert list_turns(home, sid)[0]["status"] == "running"


def test_answer_is_idempotent_and_recovery_claim_is_single_use(tmp_path):
    home = tmp_path / ".hermes"
    sid = "sess-recovery"
    turn_id = "turn_recovery"
    append(home, sid, "user", {"text": "plan this"}, turn_id=turn_id)
    payload, _seq = create_request(
        home,
        session_id=sid,
        turn_id=turn_id,
        request_id="req-1",
        questions=_questions(),
    )
    assert payload["status"] == "pending"

    svc = UserInputPromptService(home, _Bus())
    first = svc.answer(
        session_id=sid,
        request_id="req-1",
        answers={"scope": {"answers": ["Broad"]}},
    )
    second = svc.answer(
        session_id=sid,
        request_id="req-1",
        answers={"scope": {"answers": ["Narrow"]}},
    )

    assert first is not None
    assert second is not None
    assert second["answers"] == {"scope": {"answers": ["Broad"]}}

    claimed = svc.claim_recovery("req-1")
    assert claimed is not None
    assert claimed["answers"] == {"scope": {"answers": ["Broad"]}}
    assert svc.claim_recovery("req-1") is None


def test_request_event_and_prompt_insert_roll_back_together(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    sid = "sess-request-atomic"
    turn_id = "turn_request_atomic"
    real_append = prompt_repo.append_in_conn

    def fail_after_event_insert(*args, **kwargs):
        real_append(*args, **kwargs)
        raise RuntimeError("injected append failure")

    monkeypatch.setattr(prompt_repo, "append_in_conn", fail_after_event_insert)

    with pytest.raises(RuntimeError, match="injected append failure"):
        create_request(
            home,
            session_id=sid,
            turn_id=turn_id,
            request_id="req-atomic",
            questions=_questions(),
        )

    assert list_messages(home, sid) == []
    assert list_turns(home, sid) == []
    assert get_request(home, "req-atomic") is None


def test_answer_event_and_prompt_update_roll_back_together(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    sid = "sess-answer-atomic"
    turn_id = "turn_answer_atomic"
    append(home, sid, "user", {"text": "plan this"}, turn_id=turn_id)
    create_request(
        home,
        session_id=sid,
        turn_id=turn_id,
        request_id="req-answer-atomic",
        questions=_questions(),
    )
    real_append = prompt_repo.append_in_conn

    def fail_after_event_insert(*args, **kwargs):
        real_append(*args, **kwargs)
        raise RuntimeError("injected response failure")

    monkeypatch.setattr(prompt_repo, "append_in_conn", fail_after_event_insert)

    with pytest.raises(RuntimeError, match="injected response failure"):
        prompt_repo.answer_request(
            home,
            session_id=sid,
            request_id="req-answer-atomic",
            answers={"scope": {"answers": ["Broad"]}},
        )

    rows = list_messages(home, sid)
    assert [row["type"] for row in rows] == ["user", "user_input.request"]
    assert get_request(home, "req-answer-atomic")["status"] == "pending"
    assert list_turns(home, sid)[0]["status"] == "awaiting_user"


def test_transcript_hydrates_pending_user_input(tmp_path):
    home = tmp_path / ".hermes"
    sid = "sess-transcript"
    turn_id = "turn_transcript"
    append(home, sid, "user", {"text": "plan this"}, turn_id=turn_id)
    create_request(
        home,
        session_id=sid,
        turn_id=turn_id,
        request_id="req-transcript",
        questions=_questions(),
    )

    transcript = SessionService(home, state=None, meta=None).get_transcript(sid)  # type: ignore[arg-type]

    assert list_pending(home)[0]["request_id"] == "req-transcript"
    assert transcript["live_turn"]["status"] == "awaiting_user"
    assert transcript["live_turn"]["pending_user_input"]["request_id"] == "req-transcript"
    assert transcript["live_turn"]["pending_user_input"]["questions"][0]["id"] == "scope"
