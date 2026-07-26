"""Service for durable desktop Plan Mode user-input prompts."""

from __future__ import annotations

import logging
import threading
import uuid
from pathlib import Path
from typing import Any

from ..db import user_input_prompts as repo

log = logging.getLogger(__name__)


class UserInputPromptService:
    """Coordinates durable prompt state with in-process blocking waiters."""

    def __init__(self, hermes_home: Path, event_bus: Any) -> None:
        self._hermes_home = hermes_home
        self._bus = event_bus
        self._lock = threading.Lock()
        self._events: dict[str, threading.Event] = {}
        self._answers: dict[str, dict[str, Any]] = {}

    def normalize_questions(self, raw: Any) -> list[dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        questions: list[dict[str, Any]] = []
        for idx, question in enumerate(raw[:3], start=1):
            if not isinstance(question, dict):
                continue
            prompt = str(question.get("question") or "").strip()
            if not prompt:
                continue
            qid = str(question.get("id") or f"question_{idx}").strip() or f"question_{idx}"
            header = str(question.get("header") or "").strip()
            options: list[dict[str, str]] = []
            raw_options = question.get("options")
            if isinstance(raw_options, list):
                for option in raw_options[:4]:
                    if isinstance(option, dict):
                        label = str(option.get("label") or "").strip()
                        description = str(option.get("description") or "").strip()
                    else:
                        label = str(option or "").strip()
                        description = ""
                    if label or description:
                        options.append({"label": label or description, "description": description})
            questions.append({
                "id": qid,
                "header": header,
                "question": prompt,
                "options": options,
            })
        return questions

    def normalize_answers(self, raw: Any) -> dict[str, dict[str, list[str]]]:
        answers: dict[str, dict[str, list[str]]] = {}
        if not isinstance(raw, dict):
            return answers
        for key, value in raw.items():
            qid = str(key or "").strip()
            if not qid:
                continue
            values: list[str] = []
            if isinstance(value, dict):
                raw_values = value.get("answers")
                if isinstance(raw_values, list):
                    values = [str(item) for item in raw_values if str(item).strip()]
                elif raw_values is not None:
                    values = [str(raw_values)]
            elif isinstance(value, list):
                values = [str(item) for item in value if str(item).strip()]
            elif value is not None:
                values = [str(value)]
            answers[qid] = {"answers": values}
        return answers

    def request_and_wait(
        self,
        *,
        session_id: str,
        turn_id: str,
        questions: list[dict[str, Any]],
    ) -> dict[str, dict[str, list[str]]]:
        request_id = str(uuid.uuid4())
        event = threading.Event()
        with self._lock:
            self._events[request_id] = event

        try:
            payload, seq = repo.create_request(
                self._hermes_home,
                session_id=session_id,
                turn_id=turn_id,
                request_id=request_id,
                questions=questions,
            )
            self._bus.publish(session_id, seq, "user_input.request", payload)
            event.wait()
            with self._lock:
                answers = self._answers.pop(request_id, {})
            repo.mark_resumed(self._hermes_home, request_id)
            return self.normalize_answers(answers)
        finally:
            with self._lock:
                self._events.pop(request_id, None)
                self._answers.pop(request_id, None)

    def answer(
        self,
        *,
        session_id: str,
        request_id: str,
        answers: dict[str, Any],
    ) -> dict[str, Any] | None:
        normalized = self.normalize_answers(answers)
        prompt, seq, changed = repo.answer_request(
            self._hermes_home,
            session_id=session_id,
            request_id=request_id,
            answers=normalized,
        )
        if prompt is None:
            return None
        if changed and seq is not None:
            payload = {
                "request_id": request_id,
                "turn_id": prompt["turn_id"],
                "answers": normalized,
                "status": "answered",
            }
            self._bus.publish(session_id, seq, "user_input.response", payload)
        return prompt

    def wake_waiter(self, request_id: str, answers: dict[str, Any]) -> bool:
        with self._lock:
            event = self._events.get(request_id)
            if event is None:
                return False
            self._answers[request_id] = self.normalize_answers(answers)
            event.set()
        repo.mark_resumed(self._hermes_home, request_id)
        return True

    def claim_recovery(self, request_id: str) -> dict[str, Any] | None:
        return repo.claim_recovery(self._hermes_home, request_id)

    def mark_failed(self, request_id: str, error: str) -> bool:
        return repo.mark_failed(self._hermes_home, request_id, error)

    def cancel_turn(self, session_id: str, turn_id: str, reason: str) -> None:
        request_ids = repo.cancel_turn(self._hermes_home, session_id, turn_id, reason)
        if not request_ids:
            return
        with self._lock:
            for request_id in request_ids:
                event = self._events.get(request_id)
                if event is None:
                    continue
                self._answers[request_id] = {}
                event.set()

    def list_pending(self) -> list[dict[str, Any]]:
        return repo.list_pending(self._hermes_home)
