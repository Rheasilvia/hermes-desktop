"""TitleService — fire-and-forget title generation for new conversations."""

from __future__ import annotations

import logging
import threading
from typing import Any

from .interfaces import SessionStateStore

log = logging.getLogger(__name__)


class TitleService:
    """Fire-and-forget title generation for new conversations.

    Uses a small/fast model (via TitleModelSelector) while reusing the
    session agent's credentials. Runs in a daemon thread so it never blocks
    the agent turn.
    """

    def __init__(
        self,
        state: SessionStateStore,
        event_bus: Any,
        agent_pool: Any,
    ) -> None:
        self._state = state
        self._bus = event_bus
        self._pool = agent_pool

    def maybe_generate_title(self, session_id: str, user_message: str) -> None:
        """If this is the first exchange, spawn a daemon thread to generate a title.

        Called BEFORE the agent turn so generation runs in parallel with the LLM call.
        Non-blocking. Errors in the title thread are silently logged.
        """
        try:
            llm_history = self._state.get_messages_as_conversation(session_id)
            if len(llm_history) > 1:
                return

            from .title_model import TitleModelSelector

            agent = self._pool.get_agent_for_session(session_id)
            if agent is None:
                return

            provider = getattr(agent, "provider", "") or ""
            current_model = getattr(agent, "model", "") or ""
            title_provider, title_model = TitleModelSelector.select(provider, current_model)

            threading.Thread(
                target=self._generate_title_bg,
                args=(session_id, user_message, agent, title_model),
                daemon=True,
                name="auto-title",
            ).start()
        except Exception:
            log.debug("title trigger skipped for %s", session_id, exc_info=True)

    def _generate_title_bg(
        self, session_id: str, user_message: str, agent: Any, title_model: str
    ) -> None:
        try:
            from agent.title_generator import generate_title as _gen_title

            title = _gen_title(
                user_message=user_message,
                assistant_response="",
                agent=agent,
                title_model=title_model,
            )
            if title:
                self._state.set_session_title(session_id, title)
                self._bus.publish(session_id, 0, "session.title_update", {"title": title})
        except Exception:
            log.debug("auto-title failed for %s", session_id, exc_info=True)
