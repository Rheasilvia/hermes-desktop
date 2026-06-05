"""classify_agent_error — map raw exceptions from agent turns to structured error payloads.

Never leaks raw stack traces, base_url, or internal paths to the frontend.
Full exception detail is always logged server-side via log.exception.
"""
from __future__ import annotations

import re
from typing import Any

# Error codes surfaced to the frontend
CODE_PROVIDER_AUTH = "provider_auth"
CODE_PROVIDER_UNREACHABLE = "provider_unreachable"
CODE_MODEL_NOT_FOUND = "model_not_found"
CODE_RATE_LIMITED = "rate_limited"
CODE_CONTEXT_OVERFLOW = "context_overflow"
CODE_AGENT_ERROR = "agent_error"

_AUTH_PATTERNS = re.compile(
    r"(invalid.?api.?key|authentication.?failed|unauthorized|403|401"
    r"|api key|no provider|api_key|incorrect.?api.?key|invalid.?auth)",
    re.IGNORECASE,
)
_UNREACHABLE_PATTERNS = re.compile(
    r"(connection.?refused|timeout|timed.?out|unreachable|failed.?to.?connect"
    r"|network.?error|name.?resolution|no.?route|ssl.?error|certificate)",
    re.IGNORECASE,
)
_MODEL_NOT_FOUND_PATTERNS = re.compile(
    r"(model.?not.?found|does.?not.?exist|unknown.?model|invalid.?model"
    r"|no.?such.?model|model.*removed|404)",
    re.IGNORECASE,
)
_RATE_LIMITED_PATTERNS = re.compile(
    r"(rate.?limit|too.?many.?requests|429|quota.?exceeded|resource.?exhausted)",
    re.IGNORECASE,
)
_CONTEXT_PATTERNS = re.compile(
    r"(context.?length|context.?window|maximum.?token|token.?limit|too.?long"
    r"|input.?too.?large|max.?tokens.?exceeded)",
    re.IGNORECASE,
)


def classify_agent_error(exc: BaseException) -> dict[str, Any]:
    """Classify a raised exception. See classify_error_message."""
    return classify_error_message(str(exc))


def classify_error_message(raw: str) -> dict[str, Any]:
    """Return a structured error payload safe to send to the frontend.

    Accepts a raw error string (from a raised exception OR from a
    run_conversation result that returned {"failed": True, "error": ...}
    without raising, e.g. a non-retryable HTTP 401).

    Fields: code, message, hint, retryable.
    """
    raw = raw or ""

    # Strip any URL / base_url that might contain secrets
    redacted = re.sub(r"https?://[^\s\"'<>]+", "<url>", raw)

    if _AUTH_PATTERNS.search(raw):
        return {
            "code": CODE_PROVIDER_AUTH,
            "message": "Model provider authentication failed.",
            "hint": "Check your API key in Model Settings.",
            "retryable": False,
        }
    if _RATE_LIMITED_PATTERNS.search(raw):
        return {
            "code": CODE_RATE_LIMITED,
            "message": "Rate limit reached for this provider.",
            "hint": "Wait a moment before sending another message.",
            "retryable": True,
        }
    if _MODEL_NOT_FOUND_PATTERNS.search(raw):
        return {
            "code": CODE_MODEL_NOT_FOUND,
            "message": "The selected model is no longer available.",
            "hint": "Choose a different model in Model Settings.",
            "retryable": False,
        }
    if _UNREACHABLE_PATTERNS.search(raw):
        return {
            "code": CODE_PROVIDER_UNREACHABLE,
            "message": "Could not reach the model provider.",
            "hint": "Check your internet connection or provider base URL.",
            "retryable": True,
        }
    if _CONTEXT_PATTERNS.search(raw):
        return {
            "code": CODE_CONTEXT_OVERFLOW,
            "message": "The conversation is too long for this model's context window.",
            "hint": "Start a new conversation or switch to a model with a larger context.",
            "retryable": False,
        }

    # Generic fallback — include a safe redacted excerpt for debugging
    excerpt = redacted[:120] if len(redacted) > 120 else redacted
    return {
        "code": CODE_AGENT_ERROR,
        "message": "The agent encountered an error.",
        "hint": f"Details: {excerpt}",
        "retryable": False,
    }
