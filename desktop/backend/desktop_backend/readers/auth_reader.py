# SNAPSHOT: desktop_backend/readers/auth_reader.py
# Resync _KNOWN_MODELS when hermes_cli/models.py:_PROVIDER_MODELS changes.
"""Reads auth.json credential_pool to surface providers configured via TUI setup."""
from __future__ import annotations

import json
from pathlib import Path

from ..schemas.model import MergedProvider, ProviderOverlay

# Curated model lists for providers that come from auth.json but are absent
# from the desktop model catalog (anthropic/openai/deepseek only).
# Mirrored from hermes_cli/models.py:_PROVIDER_MODELS — update when that list changes.
_KNOWN_MODELS: dict[str, list[str]] = {
    "kimi-coding": [
        "kimi-k2.6",
        "kimi-k2.5",
        "kimi-for-coding",
        "kimi-k2-thinking",
        "kimi-k2-thinking-turbo",
        "kimi-k2-turbo-preview",
    ],
    "kimi-coding-cn": [
        "kimi-k2.6",
        "kimi-k2.5",
        "kimi-k2-thinking",
        "kimi-k2-turbo-preview",
    ],
    "minimax-cn": [
        "MiniMax-M2.7",
        "MiniMax-M2.7-highspeed",
        "MiniMax-M2.5",
        "MiniMax-M2.5-highspeed",
        "MiniMax-M2.1",
        "MiniMax-M2",
    ],
    "minimax": [
        "MiniMax-M2.7",
        "MiniMax-M2.7-highspeed",
        "MiniMax-M2.5",
        "MiniMax-M2.5-highspeed",
        "MiniMax-M2.1",
        "MiniMax-M2",
    ],
}


def _display_name(provider_id: str) -> str:
    return provider_id.replace("-", " ").replace("_", " ").title()


def read_auth_providers(hermes_home: Path) -> list[MergedProvider]:
    """Return MergedProvider entries for every provider in auth.json credential_pool.

    Providers found here but absent from the model catalog (e.g. kimi-coding,
    minimax-cn) are synthesised so the desktop model page can show them as
    configured without requiring a catalog entry.
    """
    auth_file = hermes_home / "auth.json"
    if not auth_file.exists():
        return []
    try:
        data = json.loads(auth_file.read_text(encoding="utf-8"))
    except Exception:
        return []

    pool = data.get("credential_pool", {})
    if not isinstance(pool, dict):
        return []

    providers: list[MergedProvider] = []
    for pid, entries in pool.items():
        if not isinstance(entries, list) or not entries:
            continue
        entry = entries[0]  # highest-priority credential
        base_url: str | None = entry.get("base_url") or None
        source: str = entry.get("source", "")
        api_key_env: str | None = (
            source.removeprefix("env:") if source.startswith("env:") else None
        )
        model_ids = _KNOWN_MODELS.get(pid, [])
        models = [{"id": m, "name": m} for m in model_ids]
        providers.append(
            MergedProvider(
                id=pid,
                name=_display_name(pid),
                auth="api_key",
                models=models,
                desktop=ProviderOverlay(
                    base_url=base_url,
                    api_key_env=api_key_env,
                ),
            )
        )
    return providers
