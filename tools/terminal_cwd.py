"""Per-context TERMINAL_CWD override — thread-safe replacement for os.getenv("TERMINAL_CWD").

Tools should call get_terminal_cwd() instead of os.getenv("TERMINAL_CWD") when they
need to respect a session-scoped workspace. The ContextVar is set by AgentExecutionService
before each agent turn, scoping it to that thread without affecting other sessions.

Resolution order:
1. ContextVar set by the current turn thread (desktop multi-session mode).
2. TERMINAL_CWD environment variable (TUI gateway, CLI, cron).
3. fallback argument.
4. os.getcwd().
"""
from __future__ import annotations

import contextvars
import os
from typing import Optional

_terminal_cwd: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "terminal_cwd",
    default=None,
)


def set_terminal_cwd(cwd: Optional[str]) -> contextvars.Token:
    """Bind the terminal CWD for the current context (turn thread).

    Returns a Token; call reset_terminal_cwd(token) in a finally block.
    """
    return _terminal_cwd.set(cwd)


def reset_terminal_cwd(token: contextvars.Token) -> None:
    """Restore the prior CWD context."""
    _terminal_cwd.reset(token)


def get_terminal_cwd(fallback: Optional[str] = None) -> str:
    """Return the effective terminal CWD.

    Resolution order:
    1. ContextVar set by the current turn thread (desktop multi-session mode).
    2. TERMINAL_CWD environment variable (TUI gateway, CLI, cron).
    3. fallback argument.
    4. os.getcwd().
    """
    ctx_value = _terminal_cwd.get()
    if ctx_value:
        return ctx_value
    env_value = os.environ.get("TERMINAL_CWD", "")
    if env_value:
        return env_value
    if fallback:
        return fallback
    return os.getcwd()


def get_context_cwd() -> Optional[str]:
    """Return ONLY the per-context (ContextVar) terminal cwd, or None.

    Unlike :func:`get_terminal_cwd`, this never falls back to ``$TERMINAL_CWD``
    or ``os.getcwd()`` — it reports solely the value bound by
    :func:`set_terminal_cwd` for the current execution context (a desktop
    session turn-thread). Callers that must distinguish a deliberately-bound
    session workspace from the process default use this.
    """
    return _terminal_cwd.get()
