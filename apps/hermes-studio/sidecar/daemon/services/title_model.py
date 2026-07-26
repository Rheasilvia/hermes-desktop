"""Select the best small/fast model for title generation per provider.

Reuses the same provider credentials but routes to the cheapest/fastest
model available. Falls back to the current conversation model when no
dedicated fast model is mapped.
"""

from __future__ import annotations


class TitleModelSelector:
    """Provider -> fastest small model for title generation."""

    FAST_MODELS = {
        "minimax": "MiniMax-M2.7",
        "minimax-cn": "MiniMax-M2.7",
        "anthropic": "claude-haiku-4-5-20251001",
        "openai": "gpt-4o-mini",
        "openrouter": "google/gemini-3-flash-preview",
        "nous": "google/gemini-3-flash-preview",
        "zai": "glm-4.5-flash",
        "gemini": "gemini-3-flash-preview",
        "kimi-coding": "kimi-k2-turbo-preview",
        "stepfun": "step-3.5-flash",
    }

    @classmethod
    def select(cls, provider: str, current_model: str = "") -> tuple[str, str]:
        """Returns (provider, model) for title generation.

        Strategy:
        1. Provider has a known fast model -> use it (same credentials, cheaper model)
        2. Provider has no mapping -> fall back to current conversation model

        Title generation ALWAYS uses the same provider credentials.
        """
        fast_model = cls.FAST_MODELS.get(provider) or current_model
        return provider, fast_model
