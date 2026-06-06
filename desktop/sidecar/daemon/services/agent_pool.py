"""Agent pool — lazy AIAgent cache with LRU eviction and running-agent pinning.

One AIAgent per session.  LRU cap (8) + 30-min idle eviction.  Running
agents (mid-turn) are pinned and never evicted.  Each prompt.execute runs
in a daemon thread with callbacks that write ui_messages rows and publish
via the event bus.

Thread safety: all mutable state is protected by a re-entrant lock.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

log = logging.getLogger(__name__)

TURN_SCOPED_UI_MESSAGE_TYPES = {
    "message.delta",
    "reasoning.delta",
    "tool.start",
    "tool.generating",
    "tool.complete",
    "tool.error",
}


@dataclass
class PooledAgent:
    """One entry in the AgentPool cache."""

    agent: Any  # AIAgent instance
    session_id: str
    last_used: float = field(default_factory=time.time)
    running: bool = False
    # Track active thread so we can join it on shutdown
    active_thread: threading.Thread | None = None
    active_turn_id: str | None = None
    # Provider/model this agent was built with — used to detect stale entries
    built_provider: str | None = None
    built_model: str | None = None
    built_cwd: str | None = None


class AgentPool:
    """Lazy AIAgent cache.

    Usage:
        pool = AgentPool(hermes_home, event_bus, session_db)
        agent, is_new = pool.get_or_create("sess-123")
        pool.start_turn("sess-123", normalized_messages)
    """

    MAX_SIZE = 8
    IDLE_EVICTION_SECONDS = 30 * 60  # 30 minutes

    def __init__(
        self,
        hermes_home: Path,
        event_bus: Any,  # EventBus — avoid circular import
        session_db: Any,  # hermes_state.SessionDB — avoid circular import
    ) -> None:
        self._hermes_home = hermes_home
        self._bus = event_bus
        self._session_db = session_db
        self._lock = threading.RLock()
        self._agents: Dict[str, PooledAgent] = {}
        self._missing_turn_warnings: set[tuple[str, str]] = set()

    def get_or_create(self, session_id: str) -> PooledAgent:
        """Return an existing PooledAgent or lazily build a new AIAgent."""
        with self._lock:
            entry = self._agents.get(session_id)
            if entry is not None:
                entry.last_used = time.time()
                return entry

            # Build a new agent
            built = self._build_agent(session_id)
            if not isinstance(built, tuple):
                agent = built
                built_model = getattr(agent, "model", None)
                built_provider = getattr(agent, "provider", None)
                session = self._session_db.get_session(session_id) if self._session_db else None
                built_cwd = (session or {}).get("cwd")
            elif len(built) == 3:
                agent, built_model, built_provider = built
                session = self._session_db.get_session(session_id) if self._session_db else None
                built_cwd = (session or {}).get("cwd")
            else:
                agent, built_model, built_provider, built_cwd = built
            entry = PooledAgent(
                agent=agent,
                session_id=session_id,
                built_model=built_model or None,
                built_provider=built_provider or None,
                built_cwd=built_cwd or None,
            )
            self._agents[session_id] = entry

            # Evict if over capacity
            self._evict_if_needed()

            return entry

    def mark_running(self, session_id: str, turn_id: str | None = None) -> None:
        with self._lock:
            entry = self._agents.get(session_id)
            if entry:
                entry.running = True
                entry.active_turn_id = turn_id

    def mark_idle(self, session_id: str, thread: threading.Thread | None = None) -> None:
        with self._lock:
            entry = self._agents.get(session_id)
            if entry:
                # Only the thread that currently owns this turn may idle it.
                # A zombie thread from a force_reset'd turn that later unblocks
                # must NOT clobber a fresh turn's running state.
                if thread is not None and entry.active_thread is not thread:
                    return
                entry.running = False
                entry.active_thread = None
                entry.active_turn_id = None
                entry.last_used = time.time()

    def set_thread(self, session_id: str, thread: threading.Thread) -> None:
        with self._lock:
            entry = self._agents.get(session_id)
            if entry:
                entry.active_thread = thread

    def get_active_turn_id(self, session_id: str) -> str | None:
        with self._lock:
            entry = self._agents.get(session_id)
            return entry.active_turn_id if entry else None

    def interrupt(self, session_id: str) -> bool:
        """Request interrupt on a running agent. Returns True if an agent was interrupted."""
        with self._lock:
            entry = self._agents.get(session_id)
            if entry is None or not entry.running:
                return False
            try:
                entry.agent.interrupt()
                return True
            except Exception:
                log.exception("interrupt failed for %s", session_id)
                return False

    def evict(self, session_id: str) -> None:
        with self._lock:
            entry = self._agents.get(session_id)
            if entry and not entry.running:
                del self._agents[session_id]

    def force_reset(self, session_id: str) -> bool:
        """Forcibly free a session, even if it is still 'running'.

        Signals interrupt on the agent and drops the cached entry. Used to
        recover a wedged turn whose thread is blocked (e.g. a stalled provider
        stream) and will therefore never reach mark_idle. The blocked thread
        becomes a detached zombie; the thread-identity guard in mark_idle keeps
        it from disturbing a future turn for this session. The next prompt for
        this session builds a fresh agent.

        Returns True if an entry was reset.
        """
        with self._lock:
            entry = self._agents.get(session_id)
            if entry is None:
                return False
            try:
                entry.agent.interrupt()
            except Exception:
                log.exception("force_reset interrupt failed for %s", session_id)
            del self._agents[session_id]
            log.info("[agent_pool] force-reset session %s (was running=%s)", session_id, entry.running)
            return True

    def evict_if_stale(
        self,
        session_id: str,
        provider: str | None,
        model: str | None,
        cwd: str | None,
    ) -> bool:
        """Evict the cached agent if provider, model, or cwd differs from build time.

        Returns True if evicted. Skips eviction if the agent is currently running.
        This is needed because setSessionProvider updates the DB before prompt.execute
        arrives, so sync_model_from_frontend would see no change in the DB.
        """
        with self._lock:
            entry = self._agents.get(session_id)
            if entry is None or entry.running:
                return False
            provider_stale = bool(provider) and entry.built_provider != provider
            model_stale = bool(model) and entry.built_model != model
            cwd_stale = bool(cwd) and entry.built_cwd != cwd
            if provider_stale or model_stale or cwd_stale:
                log.info(
                    "[agent_pool] evicting stale agent for %s: built=(%r,%r,%r) requested=(%r,%r,%r)",
                    session_id,
                    entry.built_provider,
                    entry.built_model,
                    entry.built_cwd,
                    provider,
                    model,
                    cwd,
                )
                del self._agents[session_id]
                if self._session_db:
                    try:
                        self._session_db.update_system_prompt(session_id, None)
                    except Exception:
                        log.debug("failed to clear cached system prompt for %s", session_id, exc_info=True)
                return True
            return False

    def shutdown(self) -> None:
        """Interrupt all running agents and clear the pool."""
        with self._lock:
            for sid, entry in list(self._agents.items()):
                if entry.running:
                    try:
                        entry.agent.interrupt()
                    except Exception:
                        pass
            self._agents.clear()

    # ── public accessors ───────────────────────────────────────────────────

    def is_running(self, session_id: str) -> bool:
        """Return True if the agent for session_id exists and is currently running."""
        with self._lock:
            entry = self._agents.get(session_id)
            return entry is not None and entry.running

    def get_pooled_entry(self, session_id: str) -> PooledAgent | None:
        """Return the PooledAgent for session_id, or None if not in the pool."""
        with self._lock:
            return self._agents.get(session_id)

    def get_agent_for_session(self, session_id: str) -> Any:
        """Return the raw AIAgent instance, or None if not in the pool."""
        with self._lock:
            entry = self._agents.get(session_id)
            return entry.agent if entry else None

    # ── internals ─────────────────────────────────────────────────────────

    def _build_agent(self, session_id: str) -> Any:
        """Create a new AIAgent with daemon callbacks wired in."""
        _t0_total = time.time()
        from agent.agent_init import init_agent
        from run_agent import AIAgent

        from ..readers.hermes_config import read_active_model
        from ..overlays import loader as overlays_loader
        from ..db.connection import connect as desktop_connect, ensure_schema

        # Step 1: Read provider from desktop meta; cwd is canonical in state.db.
        provider = None
        _t0 = time.time()
        try:
            conn = desktop_connect(self._hermes_home)
            ensure_schema(conn)
            row = conn.execute(
                "SELECT provider FROM session_desktop_meta WHERE session_id = ?",
                (session_id,),
            ).fetchone()
            if row:
                provider = row["provider"]
            conn.close()
        except Exception as e:
            log.debug(f"Failed to read session_desktop_meta: {e}")
        log.info("[perf] _build_agent step1 meta read: %.2fs", time.time() - _t0)

        # Step 2: Read model from session record
        session = self._session_db.get_session(session_id) if self._session_db else None
        model = session.get("model") if session else ""
        cwd = session.get("cwd") if session else ""

        # Step 3: Fallback to config.yaml if session is missing either field.
        # Fall back the PAIR atomically — never mix session model with global provider
        # (or vice versa), which would cause a mismatched provider+model pairing.
        if not provider or not model:
            active = read_active_model(self._hermes_home)
            provider = active.get("provider") or provider
            model = active.get("model") or model or ""

        base_url = ""
        api_key = ""
        api_mode: str | None = None
        if provider:
            # Canonicalize the provider id (alias → canonical, e.g. "kimi" → "kimi-coding")
            # so the overlay lookup and the registry-default comparison work even when a
            # session stored an alias. resolve_provider() is side-effect-free for a concrete
            # provider (it only normalizes via the alias map); it raises for unknown ids.
            canonical = provider
            registry_default_base_url = ""
            try:
                from hermes_cli.auth import resolve_provider as _resolve_provider, PROVIDER_REGISTRY
                try:
                    canonical = _resolve_provider(provider)
                except Exception:
                    canonical = provider
                _pcfg = PROVIDER_REGISTRY.get(canonical) or PROVIDER_REGISTRY.get(provider)
                if _pcfg is not None:
                    registry_default_base_url = str(
                        getattr(_pcfg, "inference_base_url", "") or getattr(_pcfg, "base_url", "") or ""
                    ).strip().rstrip("/")
            except Exception:
                pass

            overlay = overlays_loader.load(self._hermes_home, "model")
            prov_cfg = overlay.get(provider) or overlay.get(canonical) or {}
            if isinstance(prov_cfg, dict):
                api_key = str(prov_cfg.get("api_key") or "").strip()
                overlay_base_url = str(prov_cfg.get("base_url") or "").strip().rstrip("/")
                # Only honor a stored base_url when it is a GENUINE user override — not the
                # provider registry's default. Persisting the default (a known bug) would
                # defeat the CLI's dynamic base_url resolution: e.g. sk-kimi- keys must route
                # to api.kimi.com/coding, but the moonshot.ai default would override that → 401.
                # When it's just the default, leave base_url empty so the resolver below
                # recomputes the correct endpoint.
                if overlay_base_url and overlay_base_url != registry_default_base_url:
                    base_url = overlay_base_url

            # If we have no genuine base_url/api_key override, resolve from the credential
            # pool so init_agent gets the correct endpoint + api_mode. The resolver applies
            # provider-specific logic (_resolve_kimi_base_url / _resolve_zai_base_url /
            # OAuth-region) and canonicalizes the provider alias internally.
            _t0_cred = time.time()
            if not base_url or not api_key:
                try:
                    import os as _os
                    from contextlib import contextmanager
                    from hermes_cli.auth import resolve_api_key_provider_credentials

                    @contextmanager
                    def _set_hermes_home(path):
                        prev = _os.environ.get("HERMES_HOME")
                        _os.environ["HERMES_HOME"] = str(path)
                        try:
                            yield
                        finally:
                            if prev is None:
                                _os.environ.pop("HERMES_HOME", None)
                            else:
                                _os.environ["HERMES_HOME"] = prev

                    # Resolve with the CANONICAL id — the raw alias (e.g. "kimi")
                    # raises "not an API-key provider"; "kimi-coding" resolves correctly.
                    with _set_hermes_home(self._hermes_home):
                        creds = resolve_api_key_provider_credentials(canonical)
                    if not base_url:
                        base_url = str(creds.get("base_url") or "").strip().rstrip("/")
                    if not api_key:
                        api_key = str(creds.get("api_key") or "").strip()
                except Exception:
                    pass
            log.info("[perf] _build_agent credential resolution: %.2fs (provider=%r)", time.time() - _t0_cred, provider)

            # Determine the wire protocol (api_mode) for this provider+endpoint so
            # init_agent builds the CORRECT client up front. Without this, kimi's
            # /coding endpoint (Anthropic protocol) is mis-detected as chat_completions
            # → an OpenAI client is built and the anthropic client stays None →
            # "'NoneType' object has no attribute 'messages'". Reuse the CLI's generic
            # mapper (single source of truth; covers kimi /coding, /anthropic, OpenAI, Bedrock).
            try:
                from hermes_cli.providers import determine_api_mode
                api_mode = determine_api_mode(canonical, base_url) or None
            except Exception:
                api_mode = None

        log.info(
            "[agent_pool] building agent: provider=%r model=%r base_url=%r api_mode=%r",
            provider, model, base_url, api_mode,
        )

        agent = AIAgent(
            session_id=session_id,
            quiet_mode=True,  # suppress terminal spinner output
            skip_context_files=False,
            skip_memory=True,  # memory not in scope yet
            platform="desktop",
        )
        if cwd:
            agent.workspace_cwd = cwd
            agent.session_cwd = cwd

        # Wire callbacks
        _t0_init = time.time()
        from contextlib import ExitStack
        init_cwd_context = ExitStack()
        if cwd:
            from agent.runtime_cwd import reset_session_cwd, set_session_cwd
            from tools.terminal_cwd import reset_terminal_cwd, set_terminal_cwd
            init_cwd_context.callback(reset_terminal_cwd, set_terminal_cwd(cwd))
            init_cwd_context.callback(reset_session_cwd, set_session_cwd(cwd))
        with init_cwd_context:
            init_agent(
                agent,
                session_id=session_id,
                session_db=self._session_db,
                quiet_mode=True,
                provider=provider or None,
                model=model,
                base_url=base_url or None,
                api_key=api_key or None,
                api_mode=api_mode,
                stream_delta_callback=self._make_stream_delta_cb(session_id),
                tool_start_callback=(_tool_start_cb := self._make_tool_start_cb(session_id)),
                tool_complete_callback=self._make_tool_complete_cb(session_id, _tool_start_cb),
                reasoning_callback=self._make_reasoning_cb(session_id),
                tool_gen_callback=self._make_tool_gen_cb(session_id),
                platform="desktop",
            )

        # Store cwd on agent for system prompt and tool CWD.
        if cwd:
            # Register path approval callback for workspace boundary enforcement
            from tools.path_approval import (
                register_path_approval_notify,
                register_hermes_home,
                preload_session_approvals,
            )
            from ..db.ui_messages import append as ui_append

            # Ensure hermes_home is wired for DB persistence
            register_hermes_home(lambda: self._hermes_home)

            def _path_approval_cb(payload: dict) -> None:
                raw_turn_id = payload.get("turn_id")
                turn_id = str(raw_turn_id) if raw_turn_id else None
                seq = ui_append(self._hermes_home, session_id, "approval.request", payload, turn_id=turn_id)
                publish_payload = {**payload, **({"turn_id": turn_id} if turn_id else {})}
                self._bus.publish(session_id, seq, "approval.request", publish_payload)
                # Persist pending state for SSE reconnect recovery
                persist_payload = {**payload, "status": "pending"}
                ui_append(self._hermes_home, session_id, "pending_approval", persist_payload, turn_id=turn_id)

            register_path_approval_notify(session_id, _path_approval_cb)

            # Pre-populate in-memory cache with any historical session approvals
            # from DB so resuming a session doesn't re-prompt already-approved keys.
            preload_session_approvals(session_id)

        # Update session model column to the actually-resolved model
        # (session is created with a default model before agent resolution).
        if self._session_db and model:
            try:
                self._session_db.conn.execute(
                    "UPDATE sessions SET model = ? WHERE id = ?",
                    (model, session_id),
                )
                self._session_db.conn.commit()
            except Exception:
                pass

        log.info("[perf] _build_agent init_agent: %.2fs | total: %.2fs (provider=%r model=%r)",
                 time.time() - _t0_init, time.time() - _t0_total, provider, model)
        return agent, model, provider, cwd

    def _evict_if_needed(self) -> None:
        """Evict least-recently-used idle agents until under capacity."""
        now = time.time()
        while len(self._agents) > self.MAX_SIZE:
            # Find evictable entries (not running, idle longest)
            candidates = sorted(
                [
                    (sid, e)
                    for sid, e in self._agents.items()
                    if not e.running
                ],
                key=lambda item: item[1].last_used,
            )
            if not candidates:
                # All agents are running — can't evict
                log.warning("agent_pool: all %d agents running, cannot evict", len(self._agents))
                break

            # Also evict agents that have been idle too long
            evicted = False
            for sid, entry in candidates:
                if now - entry.last_used > self.IDLE_EVICTION_SECONDS:
                    del self._agents[sid]
                    evicted = True
                    break

            if not evicted:
                # Evict the least recently used regardless of idle time
                sid, _entry = candidates[0]
                del self._agents[sid]

    # ── callback factories ────────────────────────────────────────────────

    def make_turn_callbacks(self, session_id: str, turn_id: str) -> Dict[str, Callable]:
        """Create callbacks that are explicitly bound to a concrete turn.

        Desktop streaming/tool callbacks can be invoked from helper threads or
        provider code paths that do not share the turn runner's execution
        context. Capturing the turn here makes ui_messages attribution stable
        without falling back to active_turn_id, which is unsafe after force_reset.
        """
        tool_start_cb = self._make_tool_start_cb(session_id, turn_id=turn_id)
        return {
            "stream_delta_callback": self._make_stream_delta_cb(session_id, turn_id=turn_id),
            "tool_start_callback": tool_start_cb,
            "tool_complete_callback": self._make_tool_complete_cb(
                session_id,
                tool_start_cb,
                turn_id=turn_id,
            ),
            "reasoning_callback": self._make_reasoning_cb(session_id, turn_id=turn_id),
            "tool_gen_callback": self._make_tool_gen_cb(session_id, turn_id=turn_id),
        }

    def _resolve_turn_id(
        self,
        payload: Dict[str, Any],
        explicit_turn_id: str | None,
    ) -> str | None:
        if explicit_turn_id:
            return explicit_turn_id
        payload_turn_id = payload.get("turn_id")
        if payload_turn_id:
            return str(payload_turn_id)
        return None

    def _warn_missing_turn_id_once(self, session_id: str, msg_type: str) -> None:
        key = (session_id, msg_type)
        with self._lock:
            if key in self._missing_turn_warnings:
                return
            self._missing_turn_warnings.add(key)
        log.warning(
            "[agent_pool] emitted %s without turn_id for %s; event will not update conversation_turns",
            msg_type,
            session_id,
        )

    def _emit_ui_message(
        self,
        session_id: str,
        msg_type: str,
        payload: Dict[str, Any],
        *,
        turn_id: str | None = None,
    ) -> None:
        """Write a ui_messages row, then publish the event on the bus."""
        from ..db.ui_messages import append

        try:
            resolved_turn_id = self._resolve_turn_id(payload, turn_id)
            if not resolved_turn_id and msg_type in TURN_SCOPED_UI_MESSAGE_TYPES:
                self._warn_missing_turn_id_once(session_id, msg_type)
            seq = append(self._hermes_home, session_id, msg_type, payload, turn_id=resolved_turn_id)
            publish_payload = {**payload, **({"turn_id": resolved_turn_id} if resolved_turn_id else {})}
            self._bus.publish(session_id, seq, msg_type, publish_payload)
        except Exception:
            log.exception("_emit_ui_message failed for %s/%s", session_id, msg_type)

    def _make_stream_delta_cb(self, session_id: str, *, turn_id: str | None = None) -> Callable[[str], None]:
        def cb(delta: str) -> None:
            self._emit_ui_message(session_id, "message.delta", {"text": delta}, turn_id=turn_id)
        return cb

    def _make_tool_start_cb(self, session_id: str, *, turn_id: str | None = None) -> Callable:
        start_times: Dict[str, float] = {}

        def cb(tool_call_id: str, name: str, args: dict = None) -> None:
            start_times[tool_call_id] = time.time()
            self._emit_ui_message(session_id, "tool.start", {
                "tool_id": tool_call_id,
                "name": name,
                "args_preview": str(args)[:200] if args else "",
            }, turn_id=turn_id)

        cb._start_times = start_times  # type: ignore[attr-defined]
        return cb

    def _make_tool_complete_cb(
        self,
        session_id: str,
        start_cb: Callable = None,
        *,
        turn_id: str | None = None,
    ) -> Callable:
        def cb(tool_call_id: str, name: str, args: dict = None, result: str = "") -> None:
            duration_s = 0.0
            if start_cb is not None and hasattr(start_cb, "_start_times"):
                t0 = start_cb._start_times.pop(tool_call_id, None)
                if t0 is not None:
                    duration_s = round(time.time() - t0, 3)
            payload = {
                "tool_id": tool_call_id,
                "name": name,
                "summary": (result or "")[:500],
                "duration_s": duration_s,
            }
            # Extract todos from todo tool result (matches tui_gateway/server.py behavior)
            if name == "todo":
                try:
                    data = json.loads(result) if isinstance(result, str) else result
                    if isinstance(data, dict) and isinstance(data.get("todos"), list):
                        payload["todos"] = data.get("todos")
                except (json.JSONDecodeError, TypeError):
                    pass
            self._emit_ui_message(session_id, "tool.complete", payload, turn_id=turn_id)

        return cb

    def _make_reasoning_cb(self, session_id: str, *, turn_id: str | None = None) -> Callable[[str], None]:
        def cb(text: str) -> None:
            self._emit_ui_message(session_id, "reasoning.delta", {"text": text}, turn_id=turn_id)
        return cb

    def _make_tool_gen_cb(
        self,
        session_id: str,
        *,
        turn_id: str | None = None,
    ) -> Callable[[str, str | None], None]:
        def cb(name: str, tool_id: str | None = None) -> None:
            payload = {"name": name, "text": name}
            if tool_id:
                payload["tool_id"] = tool_id
            self._emit_ui_message(session_id, "tool.generating", payload, turn_id=turn_id)
        return cb
