"""Prepare desktop prompt text and attached images before agent execution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class PreparedPrompt:
    run_message: Any
    display_message: str
    expanded: bool = False
    injected_tokens: int = 0
    warnings: list[str] | None = None


class ContextInjectionBlocked(Exception):
    """Raised when @ context expansion exceeds the model hard limit."""

    def __init__(self, warnings: list[str]) -> None:
        super().__init__("\n".join(warnings) or "Context injection refused.")
        self.warnings = warnings


def _context_length_for_agent(agent: Any) -> int:
    from agent.model_metadata import get_model_context_length

    return get_model_context_length(
        getattr(agent, "model", "") or "",
        base_url=getattr(agent, "base_url", "") or "",
        api_key=getattr(agent, "api_key", "") or "",
        provider=getattr(agent, "provider", "") or "",
        config_context_length=getattr(agent, "_config_context_length", None),
    )


def expand_context_references(message: str, *, cwd: str, agent: Any) -> PreparedPrompt:
    if "@" not in message:
        return PreparedPrompt(run_message=message, display_message=message)

    from agent.context_references import preprocess_context_references

    ctx = preprocess_context_references(
        message,
        cwd=cwd,
        allowed_root=cwd,
        context_length=_context_length_for_agent(agent),
    )
    if ctx.blocked:
        raise ContextInjectionBlocked(ctx.warnings)
    return PreparedPrompt(
        run_message=ctx.message,
        display_message=ctx.message,
        expanded=ctx.expanded,
        injected_tokens=ctx.injected_tokens,
        warnings=ctx.warnings,
    )


def prepare_run_message(
    *,
    message: str,
    cwd: str,
    agent: Any,
    image_paths: list[str],
    config: dict[str, Any] | None,
) -> PreparedPrompt:
    prepared = expand_context_references(message, cwd=cwd, agent=agent)
    if not image_paths:
        return prepared

    from agent.image_attachments import build_image_run_message

    provider = str(getattr(agent, "provider", "") or "")
    model = str(getattr(agent, "model", "") or "")
    run_message = build_image_run_message(
        prompt=str(prepared.run_message or ""),
        image_paths=image_paths,
        agent=agent,
        provider=provider,
        model=model,
        config=config,
        log_prefix="desktop_sidecar",
    )
    return PreparedPrompt(
        run_message=run_message,
        display_message=prepared.display_message,
        expanded=prepared.expanded,
        injected_tokens=prepared.injected_tokens,
        warnings=prepared.warnings,
    )


def prepare_turn_context(
    context: str | None,
    *,
    cwd: str,
    agent: Any,
) -> str | None:
    if not context:
        return None
    prepared = expand_context_references(context, cwd=cwd, agent=agent)
    return str(prepared.run_message or "").strip() or None


__all__ = [
    "ContextInjectionBlocked",
    "PreparedPrompt",
    "expand_context_references",
    "prepare_run_message",
    "prepare_turn_context",
]
