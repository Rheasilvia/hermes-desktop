# SNAPSHOT:
#   source: auth.json credential_pool written by Hermes CLI/TUI setup
#   upstream_sha: runtime data contract, not copied source
#   copied_at: 2026-06-15
#   stripped:
#     - credential mutation and setup flows
#     - secret validation and provider probing
#   resync_when:
#     - auth.json `credential_pool` shape changes
#     - credential entries rename `access_token`, `agent_key`, `base_url`, or `source`
"""Reads auth.json credential_pool to surface providers configured via TUI setup."""
from __future__ import annotations

import json
from pathlib import Path

from ..schemas.model import MergedProvider, ProviderOverlay


def _display_name(provider_id: str) -> str:
    return provider_id.replace("-", " ").replace("_", " ").title()


def read_auth_providers(hermes_home: Path) -> list[MergedProvider]:
    """Return MergedProvider entries for every provider in auth.json credential_pool.

    Providers found here but absent from the model catalog (e.g. kimi-coding,
    minimax-cn) are synthesised so the desktop model page can show them as
    configured without requiring a catalog entry.  Model lists are left empty
    here; the router enriches them via hermes_cli.models.provider_model_ids().
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
        api_key: str | None = entry.get("access_token") or entry.get("agent_key") or None
        source = str(entry.get("source") or "")
        api_key_env: str | None = (
            source.removeprefix("env:") if source.startswith("env:") else None
        )
        providers.append(
            MergedProvider(
                id=pid,
                name=_display_name(pid),
                auth="api_key",
                models=[],
                desktop=ProviderOverlay(
                    base_url=base_url,
                    api_key=api_key,
                    api_key_env=api_key_env,
                ),
            )
        )
    return providers
