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


@dataclass
class PooledAgent:
    """One entry in the AgentPool cache."""

    agent: Any  # AIAgent instance
    session_id: str
    last_used: float = field(default_factory=time.time)
    running: bool = False
    # Track active thread so we can join it on shutdown
    active_thread: threading.Thread | None = None


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

    def get_or_create(self, session_id: str) -> PooledAgent:
        """Return an existing PooledAgent or lazily build a new AIAgent."""
        with self._lock:
            entry = self._agents.get(session_id)
            if entry is not None:
                entry.last_used = time.time()
                return entry

            # Build a new agent
            agent = self._build_agent(session_id)
            entry = PooledAgent(agent=agent, session_id=session_id)
            self._agents[session_id] = entry

            # Evict if over capacity
            self._evict_if_needed()

            return entry

    def mark_running(self, session_id: str) -> None:
        with self._lock:
            entry = self._agents.get(session_id)
            if entry:
                entry.running = True

    def mark_idle(self, session_id: str) -> None:
        with self._lock:
            entry = self._agents.get(session_id)
            if entry:
                entry.running = False
                entry.active_thread = None
                entry.last_used = time.time()

    def set_thread(self, session_id: str, thread: threading.Thread) -> None:
        with self._lock:
            entry = self._agents.get(session_id)
            if entry:
                entry.active_thread = thread

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

    # ── internals ─────────────────────────────────────────────────────────

    def _build_agent(self, session_id: str) -> Any:
        """Create a new AIAgent with desktop_backend callbacks wired in."""
        from agent.agent_init import init_agent
        from run_agent import AIAgent

        from ..readers.hermes_config import read_active_model
        from ..overlays import loader as overlays_loader
        from ..db.connection import connect as desktop_connect, ensure_schema

        # Step 1: Read provider from session_desktop_meta (session-level)
        provider = None
        try:
            conn = desktop_connect(self._hermes_home)
            ensure_schema(conn)
            row = conn.execute("SELECT provider FROM session_desktop_meta WHERE session_id = ?", (session_id,)).fetchone()
            if row:
                provider = row["provider"]
            conn.close()
        except Exception as e:
            log.debug(f"Failed to read provider from session_desktop_meta: {e}")

        # Step 2: Read model from session record
        session = self._session_db.get_session(session_id) if self._session_db else None
        model = session.get("model") if session else ""

        # Step 3: Fallback to config.yaml if no provider/model found
        if not provider or not model:
            active = read_active_model(self._hermes_home)
            provider = provider or active.get("provider")
            model = model or active.get("model") or ""

        base_url = ""
        api_key = ""
        if provider:
            overlay = overlays_loader.load(self._hermes_home, "model")
            prov_cfg = overlay.get(provider, {})
            if isinstance(prov_cfg, dict):
                base_url = str(prov_cfg.get("base_url") or "").strip().rstrip("/")
                api_key = str(prov_cfg.get("api_key") or "").strip()

        log.info(
            "[agent_pool] building agent: provider=%r model=%r base_url=%r",
            provider, model, base_url,
        )

        agent = AIAgent(
            session_id=session_id,
            quiet_mode=True,  # suppress terminal spinner output
            skip_context_files=False,
            skip_memory=True,  # memory not in scope yet
            platform="desktop",
        )

        # Wire callbacks
        init_agent(
            agent,
            session_id=session_id,
            session_db=self._session_db,
            quiet_mode=True,
            provider=provider or None,
            model=model,
            base_url=base_url or None,
            api_key=api_key or None,
            stream_delta_callback=self._make_stream_delta_cb(session_id),
            tool_start_callback=self._make_tool_start_cb(session_id),
            tool_complete_callback=self._make_tool_complete_cb(session_id),
            reasoning_callback=self._make_reasoning_cb(session_id),
            tool_gen_callback=self._make_tool_gen_cb(session_id),
            platform="desktop",
        )

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

        return agent

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

    def _emit_ui_message(self, session_id: str, msg_type: str, payload: Dict[str, Any]) -> None:
        """Write a ui_messages row, then publish the event on the bus."""
        from ..db.ui_messages import append

        try:
            seq = append(self._hermes_home, session_id, msg_type, payload)
            self._bus.publish(session_id, seq, msg_type, payload)
        except Exception:
            log.exception("_emit_ui_message failed for %s/%s", session_id, msg_type)

    def _make_stream_delta_cb(self, session_id: str) -> Callable[[str], None]:
        def cb(delta: str) -> None:
            self._emit_ui_message(session_id, "message.delta", {"text": delta})
        return cb

    def _make_tool_start_cb(self, session_id: str) -> Callable[[str, str], None]:
        def cb(name: str, args_preview: str = "") -> None:
            self._emit_ui_message(session_id, "tool.start", {
                "tool_id": f"{name}_{int(time.time() * 1000)}",
                "name": name,
                "args_preview": args_preview,
            })
        return cb

    def _make_tool_complete_cb(self, session_id: str) -> Callable:
        def cb(name: str, result_summary: str = "", duration_s: float = 0.0) -> None:
            self._emit_ui_message(session_id, "tool.complete", {
                "name": name,
                "summary": result_summary,
                "duration_s": round(duration_s, 3),
            })
        return cb

    def _make_reasoning_cb(self, session_id: str) -> Callable[[str], None]:
        def cb(text: str) -> None:
            self._emit_ui_message(session_id, "reasoning.delta", {"text": text})
        return cb

    def _make_tool_gen_cb(self, session_id: str) -> Callable[[str], None]:
        def cb(text: str) -> None:
            self._emit_ui_message(session_id, "tool.generating", {"text": text})
        return cb
