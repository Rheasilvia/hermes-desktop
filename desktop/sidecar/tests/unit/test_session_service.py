"""Unit tests for SessionService.resolve_default_model.

Focus: a new conversation must default to the configured active model (the
Model Page primary), taking precedence over the model of the most recent
session. Regression guard for the desktop new-conversation model-default bug.
"""
from __future__ import annotations

from typing import Any

from daemon.services.session_service import SessionService


class FakeStateStore:
    """Minimal SessionStateStore double for resolve_default_model."""

    def __init__(self, rich_rows: list[dict] | None = None) -> None:
        self._rich_rows = rich_rows or []

    def list_sessions_rich(
        self,
        source: str,
        include_children: bool,
        order_by_last_active: bool,
        limit: int,
    ) -> list[dict]:
        return list(self._rich_rows)

    # Unused by these tests but part of the protocol.
    def get_session(self, session_id: str) -> dict | None:  # pragma: no cover
        return None

    def create_session(self, session_id: str, source: str, **kwargs: Any) -> None:  # pragma: no cover
        ...


class FakeMetaStore:
    def get_providers(self, session_ids: list[str]) -> dict[str, str | None]:  # pragma: no cover
        return {}

    def upsert_meta(self, *args: Any, **kwargs: Any) -> None:  # pragma: no cover
        ...


def _make_service(tmp_path, *, active_model=None, recent_model=None) -> SessionService:
    home = tmp_path / ".hermes"
    home.mkdir(parents=True, exist_ok=True)
    if active_model is not None:
        provider, model = active_model
        (home / "config.yaml").write_text(
            f"model:\n  provider: {provider}\n  default: {model}\n"
        )
    rich_rows = [{"model": recent_model}] if recent_model else []
    return SessionService(home, FakeStateStore(rich_rows), FakeMetaStore())


def test_explicit_model_hint_wins(tmp_path):
    svc = _make_service(tmp_path, active_model=("openai", "gpt-4"), recent_model="claude-x")
    assert svc.resolve_default_model("explicit-model") == ("explicit-model", None)


def test_configured_active_model_preferred_over_recent_session(tmp_path):
    # The Model Page primary (config active) must win over the recent session's
    # model, and carry its provider.
    svc = _make_service(
        tmp_path,
        active_model=("anthropic", "claude-opus-4-8"),
        recent_model="gpt-4o-mini",
    )
    assert svc.resolve_default_model() == ("claude-opus-4-8", "anthropic")


def test_falls_back_to_recent_session_when_no_active_model(tmp_path):
    # No config.yaml active model → inherit the most recent session's model.
    svc = _make_service(tmp_path, active_model=None, recent_model="gpt-4o-mini")
    assert svc.resolve_default_model() == ("gpt-4o-mini", None)


def test_returns_none_when_nothing_configured(tmp_path):
    svc = _make_service(tmp_path, active_model=None, recent_model=None)
    assert svc.resolve_default_model() == (None, None)
