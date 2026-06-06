"""Regression: _build_agent must pass the correct api_mode to init_agent so the
right protocol client is built.

kimi's /coding endpoint speaks the Anthropic protocol; if api_mode isn't passed,
init_agent auto-detects chat_completions, builds an OpenAI client, leaves the
anthropic client None, and the turn dies with
"'NoneType' object has no attribute 'messages'".
"""
from __future__ import annotations

from unittest.mock import MagicMock

from daemon.services.agent_pool import AgentPool


def _drive_build_agent(tmp_path, monkeypatch, *, provider: str, resolved_base_url: str) -> dict:
    """Run _build_agent with all heavy deps mocked; return the kwargs init_agent received."""
    captured: dict = {}

    # Lazy-imported inside _build_agent — patch at the source modules.
    monkeypatch.setattr("run_agent.AIAgent", lambda **kw: MagicMock(name="AIAgent"))
    monkeypatch.setattr("agent.agent_init.init_agent", lambda agent, **kw: captured.update(kw))

    # session_desktop_meta read → provider
    fake_conn = MagicMock()
    fake_conn.execute.return_value.fetchone.return_value = {"provider": provider}
    monkeypatch.setattr("daemon.db.connection.connect", lambda home: fake_conn)
    monkeypatch.setattr("daemon.db.connection.ensure_schema", lambda c: None)

    # empty overlay → base_url comes from the resolver
    monkeypatch.setattr("daemon.overlays.loader.load", lambda home, domain: {})

    # resolver returns the endpoint (api_key/base_url)
    monkeypatch.setattr(
        "hermes_cli.auth.resolve_api_key_provider_credentials",
        lambda pid: {"base_url": resolved_base_url, "api_key": "sk-test"},
    )

    session_db = MagicMock()
    session_db.get_session.return_value = {"model": "test-model", "cwd": None}

    pool = AgentPool(hermes_home=tmp_path, event_bus=MagicMock(), session_db=session_db)
    pool._build_agent("sess-1")
    return captured


def test_kimi_coding_gets_anthropic_messages(tmp_path, monkeypatch):
    kw = _drive_build_agent(
        tmp_path, monkeypatch,
        provider="kimi-coding",
        resolved_base_url="https://api.kimi.com/coding",
    )
    assert kw.get("base_url") == "https://api.kimi.com/coding"
    assert kw.get("api_mode") == "anthropic_messages"


def test_plain_openai_style_gets_chat_completions(tmp_path, monkeypatch):
    kw = _drive_build_agent(
        tmp_path, monkeypatch,
        provider="customx",  # unknown → resolve_provider falls back; URL heuristics apply
        resolved_base_url="https://api.example.com/v1",
    )
    assert kw.get("base_url") == "https://api.example.com/v1"
    assert kw.get("api_mode") == "chat_completions"
