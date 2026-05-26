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
        from tools.terminal_cwd import set_terminal_cwd, reset_terminal_cwd
        from tools.path_approval import set_workspace_context, reset_workspace_context

        entry = self._pool.get_pooled_entry(session_id)
        workspace_cwd = getattr(entry.agent if entry else None, "workspace_cwd", None)
        cwd_token = set_terminal_cwd(workspace_cwd)
        ws_tokens = set_workspace_context(workspace_cwd, session_id)

        try:
            llm_messages = self._state.get_messages_as_conversation(session_id)

            from .context_normalizer import normalize_messages
            normalized = normalize_messages(llm_messages)

            agent = entry.agent

            self._touch_session(session_id)
            self._apply_kimi_coding_mode(agent)

            result = agent.run_conversation(
                user_message=user_message,
                conversation_history=normalized,
            )

            # If interrupted before any assistant tokens, the user message was
            # already persisted to the LLM session DB by _persist_session inside
            # run_conversation. Roll it back so it doesn't silently merge into
            # the next turn's context. UI messages are left intact.
            if isinstance(result, dict) and result.get("interrupted"):
                self._rollback_orphaned_llm_user_message(session_id, agent)

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
            reset_terminal_cwd(cwd_token)
            reset_workspace_context(ws_tokens)
            self._pool.mark_idle(session_id)

    def _rollback_orphaned_llm_user_message(self, session_id: str, agent: Any) -> None:
        """Remove a trailing user message from the LLM session DB after an interrupt.

        When a turn is interrupted before any assistant tokens are generated,
        the user message is already in the messages table but has no following
        assistant response. Loading it next turn silently merges it with the
        new user message, confusing the model. This removes it.

        Only deletes when the last row for this session has role='user' — if
        any assistant tokens were streamed, the last row is 'assistant' and
        we leave it intact (partial response is meaningful context).
        """
        result = {"rolled_back": False}

        def _check_and_delete(c):
            row = c.execute(
                "SELECT id, role FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 1",
                (session_id,),
            ).fetchone()
            if row and row["role"] == "user":
                c.execute("DELETE FROM messages WHERE id = ?", (row["id"],))
                c.execute(
                    "UPDATE sessions SET message_count = max(0, message_count - 1) WHERE id = ?",
                    (session_id,),
                )
                result["rolled_back"] = True

        try:
            self._state._db._execute_write(_check_and_delete)
        except Exception:
            log.exception("failed to rollback orphaned user message for %s", session_id)
            return

        if result["rolled_back"]:
            log.info("[interrupt] rolled back orphaned user message for session %s", session_id)
            # Sync the agent's DB write cursor. _last_flushed_db_idx tracks how many
            # messages have been flushed. Without decrement, the next turn's
            # flush_from = max(start_idx, _last_flushed_db_idx) skips the new user
            # message entirely, leaving it out of the LLM context.
            if hasattr(agent, "_last_flushed_db_idx") and agent._last_flushed_db_idx > 0:
                agent._last_flushed_db_idx -= 1

    def _touch_session(self, session_id: str) -> None:
        try:
            ts = time.time()
            def _do(c):
                c.execute(
                    "UPDATE sessions SET ended_at = ? WHERE id = ?",
                    (ts, session_id),
                )
            self._state._db._execute_write(_do)
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
