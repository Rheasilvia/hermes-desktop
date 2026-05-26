"""Auto-generate short session titles from the first user/assistant exchange.

Runs asynchronously after the first response is delivered so it never
adds latency to the user-facing reply.
"""

import logging
import re
import threading
from typing import Callable, Optional

_THINK_BLOCK_RE = re.compile(
    r"<(?:think|thinking|reasoning|thought|REASONING_SCRATCHPAD)[^>]*>.*?</(?:think|thinking|reasoning|thought|REASONING_SCRATCHPAD)>",
    re.DOTALL | re.IGNORECASE,
)


def _strip_think_blocks(text: str) -> str:
    return _THINK_BLOCK_RE.sub("", text).strip()

from agent.auxiliary_client import call_llm

logger = logging.getLogger(__name__)

# Callback signature: (task_name, exception) -> None. Used to surface
# auxiliary failures to the user through AIAgent._emit_auxiliary_failure
# so silent-drops (e.g. OpenRouter 402 exhausting the fallback chain)
# become visible instead of piling up as NULL session titles.
FailureCallback = Callable[[str, BaseException], None]
TitleCallback = Callable[[str], None]

_TITLE_PROMPT = (
    "Generate a short, descriptive title (3-7 words) for a conversation that starts with the "
    "following exchange. The title should capture the main topic or intent. "
    "Write the title in the same language the user is writing in. "
    "Return ONLY the title text, nothing else. No quotes, no punctuation at the end, no prefixes."
)

_TITLE_PROMPT_PINNED_LANGUAGE = (
    "Generate a short, descriptive title (3-7 words) for a conversation that starts with the "
    "following exchange. The title should capture the main topic or intent. "
    "Write the title in {language}. "
    "Return ONLY the title text, nothing else. No quotes, no punctuation at the end, no prefixes."
)


def _title_language() -> str:
    """Return configured title language, or empty string to match the user."""
    try:
        from hermes_cli.config import load_config

        return str(
            ((load_config() or {}).get("auxiliary") or {})
            .get("title_generation", {})
            .get("language", "")
        ).strip()
    except Exception:
        return ""


def _call_with_agent(agent, messages: list, model: str = "") -> Optional[str]:
    """Call LLM using agent's configured client, handling protocol differences.

    Reuses the agent's already-configured client (credentials, base_url, api_key)
    but optionally swaps the model name (e.g. use a small/fast model for titles).

    Thread safety: OpenAI/Anthropic clients are thread-safe (httpx connection
    pool). This function only calls read-only methods on the client.
    """
    model = model or agent.model
    api_mode = getattr(agent, "api_mode", "chat_completions")

    if api_mode == "anthropic_messages":
        client = getattr(agent, "_anthropic_client", None)
        if not client:
            return None

        system_msg = None
        user_msgs = []
        for m in messages:
            if m["role"] == "system":
                system_msg = m["content"]
            else:
                user_msgs.append(m)

        kwargs = {"model": model, "max_tokens": 500, "messages": user_msgs}
        if system_msg:
            kwargs["system"] = system_msg

        response = client.messages.create(**kwargs)
        if response.content:
            for block in response.content:
                if getattr(block, "type", None) == "text":
                    return block.text
        return None
    else:
        client = getattr(agent, "client", None)
        if not client:
            return None

        response = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=500,
            temperature=0.3,
        )
        return (response.choices[0].message.content or "").strip()


def generate_title(
    user_message: str,
    assistant_response: str,
    timeout: float = 30.0,
    failure_callback: Optional[FailureCallback] = None,
    main_runtime: dict = None,
    agent=None,
    title_model: str = "",
) -> Optional[str]:
    """Generate a session title from the first exchange.

    If ``agent`` is provided, reuses its configured client (credentials, base_url)
    to make the LLM call. This ensures the title generation uses the same provider
    as the main conversation (session-level provider).

    Falls back to the auxiliary LLM client if agent-based call fails or if no
    agent is provided. The auxiliary client uses the cheapest/fastest available
    model from config.yaml + .env.

    Returns the title string or None on failure.
    ``failure_callback`` is invoked with ``(task, exception)`` when the
    auxiliary call raises — the caller typically wires this to
    ``AIAgent._emit_auxiliary_failure`` so the user sees a warning instead
    of silently accumulating untitled sessions.
    """
    # Truncate long messages to keep the request small
    user_snippet = user_message[:500] if user_message else ""

    if assistant_response:
        assistant_snippet = assistant_response[:500]
        user_content = f"User: {user_snippet}\n\nAssistant: {assistant_snippet}"
    else:
        user_content = f"User: {user_snippet}"

    language = _title_language()
    prompt = _TITLE_PROMPT_PINNED_LANGUAGE.format(language=language) if language else _TITLE_PROMPT

    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": user_content},
    ]

    # Try agent's client first (uses session-specific provider config)
    if agent:
        try:
            title = _call_with_agent(agent, messages, model=title_model)
            if title:
                title = _strip_think_blocks(title)
                title = title.strip('"\'')
                if title.lower().startswith("title:"):
                    title = title[6:].strip()
                if len(title) > 80:
                    title = title[:77] + "..."
                return title
        except Exception as e:
            logger.debug("Agent-based title generation failed: %s", e)
            # Fall through to auxiliary client

    # Fallback: auxiliary client (for TUI/ACP or when agent.client failed)
    try:
        response = call_llm(
            task="title_generation",
            messages=messages,
            max_tokens=500,
            temperature=0.3,
            timeout=timeout,
            main_runtime=main_runtime,
        )
        title = _strip_think_blocks(response.choices[0].message.content or "")
        # Clean up: remove quotes, trailing punctuation, prefixes like "Title: "
        title = title.strip('"\'')
        if title.lower().startswith("title:"):
            title = title[6:].strip()
        # Enforce reasonable length
        if len(title) > 80:
            title = title[:77] + "..."
        return title if title else None
    except Exception as e:
        # Log at WARNING so this shows up in agent.log without debug mode.
        # Full detail at debug level for operators who need the stack.
        logger.warning("Title generation failed: %s", e)
        logger.debug("Title generation traceback", exc_info=True)
        if failure_callback is not None:
            try:
                failure_callback("title generation", e)
            except Exception:
                logger.debug("Title generation failure_callback raised", exc_info=True)
        return None


def auto_title_session(
    session_db,
    session_id: str,
    user_message: str,
    assistant_response: str,
    failure_callback: Optional[FailureCallback] = None,
    main_runtime: dict = None,
    title_callback: Optional[TitleCallback] = None,
    agent=None,
) -> None:
    """Generate and set a session title if one doesn't already exist.

    Called in a background thread after the first exchange completes.
    Silently skips if:
    - session_db is None
    - session already has a title (user-set or previously auto-generated)
    - title generation fails
    """
    if not session_db or not session_id:
        return

    # Check if title already exists (user may have set one via /title before first response)
    try:
        existing = session_db.get_session_title(session_id)
        if existing:
            return
    except Exception:
        return

    title = generate_title(
        user_message, assistant_response, failure_callback=failure_callback,
        main_runtime=main_runtime, agent=agent
    )
    if not title:
        return

    try:
        session_db.set_session_title(session_id, title)
        logger.debug("Auto-generated session title: %s", title)
        if title_callback is not None:
            try:
                title_callback(title)
            except Exception:
                logger.debug("Auto-title callback failed", exc_info=True)
    except Exception as e:
        logger.debug("Failed to set auto-generated title: %s", e)


def maybe_auto_title(
    session_db,
    session_id: str,
    user_message: str,
    assistant_response: str,
    conversation_history: list,
    failure_callback: Optional[FailureCallback] = None,
    main_runtime: dict = None,
    title_callback: Optional[TitleCallback] = None,
    agent=None,
) -> None:
    """Fire-and-forget title generation after the first exchange.

    Only generates a title when:
    - This appears to be the first user→assistant exchange
    - No title is already set
    """
    if not session_db or not session_id or not user_message or not assistant_response:
        return

    # Count user messages in history to detect first exchange.
    # conversation_history includes the exchange that just happened,
    # so for a first exchange we expect exactly 1 user message
    # (or 2 counting system). Be generous: generate on first 2 exchanges.
    user_msg_count = sum(1 for m in (conversation_history or []) if m.get("role") == "user")
    if user_msg_count > 2:
        return

    thread = threading.Thread(
        target=auto_title_session,
        args=(session_db, session_id, user_message, assistant_response),
        kwargs={
            "failure_callback": failure_callback,
            "main_runtime": main_runtime,
            "title_callback": title_callback,
            "agent": agent,
        },
        daemon=True,
        name="auto-title",
    )
    thread.start()
