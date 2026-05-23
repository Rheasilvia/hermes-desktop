"""AgentExecutionService — orchestrates agent turn execution in a daemon thread."""

from __future__ import annotations

import logging
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .exceptions import SessionBusyError
from .interfaces import SessionStateStore, UIMessageStore

log = logging.getLogger(__name__)


class AgentExecutionService:
    """Orchestrates a single agent turn: history, normalization, agent run,
    result/error emission, and model backfill.
    """

    def __init__(
        self,
        hermes_home: Path,
        state: SessionStateStore,
        ui_messages: UIMessageStore,
        event_bus: Any,
        agent_pool: Any,
        session_service: Any,
    ) -> None:
        self._hermes_home = hermes_home
        self._state = state
        self._ui = ui_messages
        self._bus = event_bus
        self._pool = agent_pool
        self._session_svc = session_service

    def execute_turn(self, session_id: str, user_message: str) -> threading.Thread:
        """Spawn a daemon thread to run the agent turn. Returns the started thread.

        The caller (prompt_execute route) must have already called
        pool.get_or_create(sid) and verified the agent is not running.
        """
        entry = self._pool.get_pooled_entry(session_id)
        if entry is None or entry.running:
            raise SessionBusyError()

        user_seq = self._ui.append(session_id, "user", {"text": user_message})
        self._bus.publish(session_id, user_seq, "user", {"text": user_message})
        self._bus.publish(session_id, user_seq, "message.start", {"message_id": str(uuid.uuid4())})

        self._pool.mark_running(session_id)

        thread = threading.Thread(
            target=self._run_turn,
            args=(session_id, user_message),
            daemon=True,
            name=f"agent-turn-{session_id[:8]}",
        )
        self._pool.set_thread(session_id, thread)
        thread.start()
        return thread

    def _run_turn(self, session_id: str, user_message: str) -> None:
        try:
            llm_messages = self._state.get_messages_as_conversation(session_id)

            from .context_normalizer import normalize_messages
            normalized = normalize_messages(llm_messages)

            entry = self._pool.get_pooled_entry(session_id)
            agent = entry.agent

            self._touch_session(session_id)
            self._apply_kimi_coding_mode(agent)

            result = agent.run_conversation(
                user_message=user_message,
                conversation_history=normalized,
            )

            final_text = ""
            if isinstance(result, dict):
                final_text = result.get("final_response", "")
            elif isinstance(result, str):
                final_text = result

            seq = self._ui.append(session_id, "message.complete", {
                "text": final_text,
                "rendered": False,
            })
            self._bus.publish(session_id, seq, "message.complete", {
                "text": final_text,
                "rendered": False,
            })

            self._session_svc.backfill_model_if_unset(
                session_id, getattr(agent, "model", "")
            )

        except Exception as exc:
            log.exception("agent turn failed for %s", session_id)
            error_msg = str(exc)[:500]
            seq = self._ui.append(session_id, "turn_error", {"error": error_msg})
            self._bus.publish(session_id, seq, "error", {"message": error_msg})

        finally:
            self._pool.mark_idle(session_id)

    def _touch_session(self, session_id: str) -> None:
        try:
            self._state._db._conn.execute(
                "UPDATE sessions SET ended_at = ? WHERE id = ?",
                (time.time(), session_id),
            )
            self._state._db._conn.commit()
        except Exception:
            pass

    def _apply_kimi_coding_mode(self, agent: Any) -> None:
        provider = getattr(agent, "provider", "")
        if provider not in ("kimi-coding", "kimi-coding-cn"):
            return
        try:
            from hermes_cli.auth import resolve_api_key_provider_credentials
            creds = resolve_api_key_provider_credentials(provider)
            bu = creds.get("base_url", "")
            if "api.kimi.com" in bu and "/coding" in bu:
                agent.api_mode = "anthropic_messages"
        except Exception:
            pass
