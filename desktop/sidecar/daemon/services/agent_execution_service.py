"""AgentExecutionService — orchestrates agent turn execution in a daemon thread."""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .exceptions import SessionBusyError
from .interfaces import SessionStateStore, UIMessageStore

log = logging.getLogger(__name__)

_pending_prompt_lock = threading.Lock()
_pending_prompt_events: dict[str, threading.Event] = {}
_pending_prompt_answers: dict[str, str] = {}


def resolve_blocking_prompt(request_id: str, value: str) -> bool:
    """Resolve a Desktop blocking prompt raised from the agent worker thread."""
    with _pending_prompt_lock:
        event = _pending_prompt_events.get(request_id)
        if event is None:
            return False
        _pending_prompt_answers[request_id] = value
        event.set()
        return True


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

    def _install_turn_bound_callbacks(
        self,
        agent: Any,
        session_id: str,
        turn_id: str,
    ) -> list[tuple[str, bool, Any]]:
        make_callbacks = getattr(self._pool, "make_turn_callbacks", None)
        if not callable(make_callbacks):
            return []

        previous: list[tuple[str, bool, Any]] = []
        callbacks = make_callbacks(session_id, turn_id)
        for attr, callback in callbacks.items():
            previous.append((attr, hasattr(agent, attr), getattr(agent, attr, None)))
            setattr(agent, attr, callback)
        return previous

    @staticmethod
    def _restore_turn_bound_callbacks(
        agent: Any,
        previous: list[tuple[str, bool, Any]],
    ) -> None:
        for attr, existed, value in reversed(previous):
            if existed:
                setattr(agent, attr, value)
                continue
            try:
                delattr(agent, attr)
            except AttributeError:
                pass

    def execute_turn(
        self,
        session_id: str,
        user_message: str,
        *,
        context: str | None = None,
        slash_command: dict | None = None,
        display_parts: list[dict] | None = None,
    ) -> dict[str, Any]:
        """Spawn a daemon thread to run the agent turn. Returns the started thread.

        The caller (prompt_execute route) must have already called
        pool.get_or_create(sid) and verified the agent is not running.

        Args:
            context: Optional expanded skill/system context injected into the
                     LLM conversation for this turn only (not stored in DB).
            slash_command: Optional {command, args} metadata persisted alongside
                           the user message for UI display on reload.
        """
        entry = self._pool.get_pooled_entry(session_id)
        if entry is None or entry.running:
            raise SessionBusyError()

        turn_id = f"turn_{uuid.uuid4().hex}"
        user_payload = {"text": user_message, "turn_id": turn_id}
        if slash_command:
            user_payload["slash_command"] = slash_command
        if display_parts:
            user_payload["display_parts"] = display_parts
        user_seq = self._ui.append(session_id, "user", user_payload, turn_id=turn_id)
        self._bus.publish(session_id, user_seq, "user", user_payload)
        start_payload = {
            "message_id": str(uuid.uuid4()),
            "turn_id": turn_id,
        }
        start_seq = self._ui.append(session_id, "message.start", start_payload, turn_id=turn_id)
        self._bus.publish(session_id, start_seq, "message.start", start_payload)

        self._pool.mark_running(session_id, turn_id)

        thread = threading.Thread(
            target=self._run_turn,
            args=(session_id, user_message, user_seq, turn_id, context),
            daemon=True,
            name=f"agent-turn-{session_id[:8]}",
        )
        self._pool.set_thread(session_id, thread)
        thread.start()
        return {"thread": thread, "turn_id": turn_id, "user_seq": user_seq}

    def _run_turn(self, session_id: str, user_message: str, user_seq: int, turn_id: str, context: str | None = None) -> None:
        from contextlib import ExitStack
        from agent.runtime_cwd import reset_session_cwd, set_session_cwd
        from tools.terminal_cwd import set_terminal_cwd, reset_terminal_cwd
        from tools.path_approval import set_workspace_context, reset_workspace_context
        from tools.terminal_tool import set_sudo_password_callback
        from tools.skills_tool import set_secret_capture_callback

        _t0_total = time.time()
        entry = self._pool.get_pooled_entry(session_id)
        agent = entry.agent if entry else None
        turn_callback_snapshot: list[tuple[str, bool, Any]] = []
        workspace_cwd = getattr(entry, "built_cwd", None) or getattr(agent, "workspace_cwd", None)
        permission_mode_snapshot = "auto"
        try:
            permission_mode_snapshot = str(
                self._session_svc.get_session_or_404(session_id).get("permissionMode") or "auto"
            )
        except Exception:
            permission_mode_snapshot = "auto"
        cleanup = ExitStack()
        cleanup.callback(reset_terminal_cwd, set_terminal_cwd(workspace_cwd))
        cleanup.callback(
            reset_workspace_context,
            set_workspace_context(
                workspace_cwd,
                session_id,
                turn_id,
                permission_mode=permission_mode_snapshot,
            ),
        )
        cleanup.callback(reset_session_cwd, set_session_cwd(workspace_cwd))
        prev_interactive = os.environ.get("HERMES_INTERACTIVE")

        def _restore_interactive() -> None:
            if prev_interactive is None:
                os.environ.pop("HERMES_INTERACTIVE", None)
            else:
                os.environ["HERMES_INTERACTIVE"] = prev_interactive

        os.environ["HERMES_INTERACTIVE"] = "1"
        cleanup.callback(_restore_interactive)
        set_sudo_password_callback(lambda: self._block_for_prompt("sudo.request", session_id, {}, timeout=120, turn_id=turn_id))
        set_secret_capture_callback(lambda env_var, prompt, metadata=None: self._capture_secret(session_id, env_var, prompt, metadata, turn_id=turn_id))

        try:
            if agent is None:
                raise RuntimeError(f"pooled agent missing for session {session_id}")
            turn_callback_snapshot = self._install_turn_bound_callbacks(agent, session_id, turn_id)

            _t0 = time.time()
            llm_messages = self._state.get_messages_as_conversation(session_id)
            log.info("[perf] _run_turn get_messages_as_conversation: %.2fs", time.time() - _t0)

            from hermes_cli.config import load_config
            from .prompt_context import (
                ContextInjectionBlocked,
                prepare_run_message,
                prepare_turn_context,
            )

            # Inject turn-scoped context (e.g. expanded skill content or
            # selected @file refs) as a system message. It is visible to the
            # LLM for this turn only and is never persisted to UI history.
            try:
                prepared_context = prepare_turn_context(
                    context,
                    cwd=workspace_cwd or "",
                    agent=agent,
                )
            except ContextInjectionBlocked as exc:
                payload = {
                    "error": str(exc),
                    "code": "CONTEXT_INJECTION_BLOCKED",
                    "hint": "\n".join(exc.warnings) if exc.warnings else None,
                    "turn_id": turn_id,
                }
                seq = self._ui.append(session_id, "turn_error", payload, turn_id=turn_id)
                self._bus.publish(session_id, seq, "error", payload)
                return
            if prepared_context:
                llm_messages.insert(0, {"role": "system", "content": prepared_context})

            from .context_normalizer import normalize_messages
            _t0 = time.time()
            normalized = normalize_messages(llm_messages)
            log.info("[perf] _run_turn normalize_messages: %.2fs", time.time() - _t0)

            self._touch_session(session_id)
            image_paths = self._session_svc.consume_attached_images(session_id)

            try:
                prepared_prompt = prepare_run_message(
                    message=user_message,
                    cwd=workspace_cwd or "",
                    agent=agent,
                    image_paths=image_paths,
                    config=load_config(),
                )
            except ContextInjectionBlocked as exc:
                payload = {
                    "error": str(exc),
                    "code": "CONTEXT_INJECTION_BLOCKED",
                    "hint": "\n".join(exc.warnings) if exc.warnings else None,
                    "turn_id": turn_id,
                }
                seq = self._ui.append(session_id, "turn_error", payload, turn_id=turn_id)
                self._bus.publish(session_id, seq, "error", payload)
                return
            for warning in prepared_prompt.warnings or []:
                payload = {
                    "message": warning,
                    "code": "CONTEXT_INJECTION_WARNING",
                    "turn_id": turn_id,
                }
                seq = self._ui.append(session_id, "warning", payload, turn_id=turn_id)
                self._bus.publish(session_id, seq, "warning", payload)

            _t0_call = time.time()
            result = agent.run_conversation(
                user_message=prepared_prompt.run_message,
                conversation_history=normalized,
            )
            log.info("[perf] _run_turn run_conversation total: %.2fs", time.time() - _t0_call)

            # If interrupted before any assistant tokens, the user message was
            # already persisted to the LLM session DB by _persist_session inside
            # run_conversation. Roll it back so it doesn't silently merge into
            # the next turn's context. UI messages are left intact.
            if isinstance(result, dict) and result.get("interrupted"):
                self._rollback_orphaned_llm_user_message(session_id, agent)

            final_text = ""
            if isinstance(result, dict):
                final_text = result.get("final_response", "") or ""
            elif isinstance(result, str):
                final_text = result

            interrupted = isinstance(result, dict) and result.get("interrupted")

            # Some provider paths stream the answer via message.delta callbacks
            # but return an empty final_response (observed with MiniMax).
            # Reconstruct the answer from the streamed deltas so the turn still
            # finalizes with its text.
            if not final_text and not interrupted:
                final_text = self._collect_streamed_text(session_id, user_seq, turn_id)

            failed = isinstance(result, dict) and result.get("failed")
            error_text = result.get("error") if isinstance(result, dict) else None

            if failed and not final_text:
                # run_conversation returned a non-raised failure (e.g. HTTP 401
                # auth) — surface it immediately as a friendly, classified error
                # so the user perceives it instead of the UI hanging with no
                # stop signal.
                from .model_errors import classify_error_message
                structured = classify_error_message(str(error_text or "Agent error"))
                payload = {"error": structured["message"], **structured, "turn_id": turn_id}
                seq = self._ui.append(
                    session_id, "turn_error", payload, turn_id=turn_id
                )
                self._bus.publish(session_id, seq, "error", {
                    "message": structured["message"],
                    "code": structured["code"],
                    "hint": structured.get("hint"),
                    "turn_id": turn_id,
                })
            elif interrupted and not final_text:
                # An interrupted turn with no output is finalized by the frontend
                # (cancelMessage). Emitting a terminal event here would let a
                # force_reset'd zombie turn reset a fresh turn's state — skip it.
                pass
            else:
                # Publish a terminal signal so the UI never hangs waiting for a
                # stop, even when final_text is empty (rendered as a no-op — no
                # empty bubble — by the frontend).
                payload = {"text": final_text, "rendered": False, "turn_id": turn_id}
                usage = self._get_usage(session_id, agent)
                if usage is not None:
                    payload["usage"] = usage
                seq = self._ui.append(session_id, "message.complete", payload, turn_id=turn_id)
                self._bus.publish(session_id, seq, "message.complete", payload)

            self._session_svc.backfill_model_if_unset(
                session_id, getattr(agent, "model", "")
            )

        except Exception as exc:
            log.exception("agent turn failed for %s", session_id)
            from .model_errors import classify_agent_error
            structured = classify_agent_error(exc)
            payload = {"error": structured["message"], **structured, "turn_id": turn_id}
            seq = self._ui.append(session_id, "turn_error", payload, turn_id=turn_id)
            self._bus.publish(session_id, seq, "error", {
                "message": structured["message"],
                "code": structured["code"],
                "hint": structured.get("hint"),
                "turn_id": turn_id,
            })

        finally:
            if agent is not None:
                self._restore_turn_bound_callbacks(agent, turn_callback_snapshot)
            cleanup.close()
            # Pass our thread identity so a force_reset'd zombie turn that later
            # unblocks cannot idle a fresh turn that has since taken over.
            self._pool.mark_idle(session_id, threading.current_thread())
            log.info("[perf] _run_turn total wall-clock: %.2fs", time.time() - _t0_total)

    def _get_usage(self, session_id: str, agent: Any) -> dict[str, Any] | None:
        """Return frontend-compatible usage from the durable session aggregate."""

        row = self._state.get_session(session_id)
        if row is None:
            return None

        def _int_row(name: str) -> int:
            value = row.get(name, 0) or 0
            try:
                return int(value)
            except (TypeError, ValueError):
                return 0

        input_tokens = _int_row("input_tokens")
        output_tokens = _int_row("output_tokens")
        cache_read_tokens = _int_row("cache_read_tokens")
        cache_write_tokens = _int_row("cache_write_tokens")
        reasoning_tokens = _int_row("reasoning_tokens")

        usage: dict[str, Any] = {
            "model": row.get("model") or getattr(agent, "model", "") or "",
            "input": input_tokens,
            "output": output_tokens,
            "cache_read": cache_read_tokens,
            "cache_write": cache_write_tokens,
            "reasoning": reasoning_tokens,
            "prompt": input_tokens + cache_read_tokens + cache_write_tokens,
            "completion": output_tokens,
            "total": (
                input_tokens
                + output_tokens
                + cache_read_tokens
                + cache_write_tokens
                + reasoning_tokens
            ),
            "calls": _int_row("api_call_count"),
        }

        actual_cost = row.get("actual_cost_usd")
        estimated_cost = row.get("estimated_cost_usd")
        cost = actual_cost if actual_cost is not None else estimated_cost
        if cost is not None:
            try:
                usage["cost_usd"] = float(cost)
            except (TypeError, ValueError):
                pass
        for source_key, target_key in (
            ("cost_status", "cost_status"),
            ("cost_source", "cost_source"),
            ("pricing_version", "pricing_version"),
            ("billing_provider", "billing_provider"),
            ("billing_base_url", "billing_base_url"),
            ("billing_mode", "billing_mode"),
        ):
            value = row.get(source_key)
            if value is not None:
                usage[target_key] = value

        comp = getattr(agent, "context_compressor", None)
        if comp:
            ctx_used = getattr(comp, "last_prompt_tokens", 0) or usage["total"] or 0
            ctx_max = getattr(comp, "context_length", 0) or 0
            try:
                ctx_used_int = int(ctx_used)
                ctx_max_int = int(ctx_max)
            except (TypeError, ValueError):
                ctx_used_int = 0
                ctx_max_int = 0
            if ctx_max_int:
                usage["context_used"] = ctx_used_int
                usage["context_max"] = ctx_max_int
                usage["context_percent"] = max(
                    0,
                    min(100, round(ctx_used_int / ctx_max_int * 100)),
                )
            try:
                usage["compressions"] = int(getattr(comp, "compression_count", 0) or 0)
            except (TypeError, ValueError):
                usage["compressions"] = 0

        return usage

    def _collect_streamed_text(self, session_id: str, user_seq: int, turn_id: str | None = None) -> str:
        """Concatenate the text of message.delta events emitted this turn.

        Used as a fallback when run_conversation streamed text via the delta
        callback but returned an empty final_response, so the finalized message
        still carries the visible answer.
        """
        try:
            rows = self._ui.list_messages(session_id, since_seq=user_seq)
        except Exception:
            log.exception("failed to collect streamed text for %s", session_id)
            return ""
        parts: list[str] = []
        for row in rows:
            row_turn_id = row.get("turn_id") or (row.get("payload") or {}).get("turn_id")
            if turn_id and row_turn_id and row_turn_id != turn_id:
                continue
            if str(row.get("type") or "") == "message.delta":
                payload = row.get("payload") or {}
                text = payload.get("text")
                if text:
                    parts.append(str(text))
        return "".join(parts)

    def _block_for_prompt(
        self,
        event_type: str,
        session_id: str,
        payload: dict[str, Any],
        timeout: int = 120,
        turn_id: str | None = None,
    ) -> str:
        request_id = str(uuid.uuid4())
        event = threading.Event()
        with _pending_prompt_lock:
            _pending_prompt_events[request_id] = event

        full_payload = {**payload, "request_id": request_id}
        if turn_id:
            full_payload["turn_id"] = turn_id
        seq = self._ui.append(session_id, event_type, full_payload, turn_id=turn_id)
        self._bus.publish(session_id, seq, event_type, full_payload)

        try:
            if not event.wait(timeout):
                return ""
            with _pending_prompt_lock:
                return _pending_prompt_answers.pop(request_id, "")
        finally:
            with _pending_prompt_lock:
                _pending_prompt_events.pop(request_id, None)
                _pending_prompt_answers.pop(request_id, None)

    def _capture_secret(
        self,
        session_id: str,
        env_var: str,
        prompt: str,
        metadata: dict[str, Any] | None = None,
        turn_id: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"prompt": prompt, "env_var": env_var}
        if metadata:
            payload["metadata"] = metadata
        value = self._block_for_prompt("secret.request", session_id, payload, turn_id=turn_id)
        if not value:
            return {
                "success": True,
                "stored_as": env_var,
                "validated": False,
                "skipped": True,
                "message": "skipped",
            }

        from hermes_cli.config import save_env_value_secure

        return {
            **save_env_value_secure(env_var, value),
            "skipped": False,
            "message": "ok",
        }

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
