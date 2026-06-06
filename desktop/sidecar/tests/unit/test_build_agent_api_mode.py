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


def _drive_build_agent(tmp_path, monkeypatch, *, provider: str, resolved_base_url: str, cwd: str | None = None) -> dict:
    """Run _build_agent with all heavy deps mocked; return the kwargs init_agent received."""
    captured: dict = {}

    # Lazy-imported inside _build_agent — patch at the source modules.
    monkeypatch.setattr("run_agent.AIAgent", lambda **kw: MagicMock(name="AIAgent"))

    def _fake_init_agent(agent, **kw):
        from agent.runtime_cwd import resolve_agent_cwd, resolve_context_cwd
        from tools.terminal_cwd import get_terminal_cwd

        captured.update(kw)
        captured["agent_workspace_cwd"] = getattr(agent, "workspace_cwd", None)
        captured["agent_session_cwd"] = getattr(agent, "session_cwd", None)
        captured["init_terminal_cwd"] = get_terminal_cwd(fallback="")
        captured["init_agent_cwd"] = str(resolve_agent_cwd())
        context_cwd = resolve_context_cwd()
        captured["init_context_cwd"] = str(context_cwd) if context_cwd is not None else None

    monkeypatch.setattr("agent.agent_init.init_agent", _fake_init_agent)

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
    session_db.get_session.return_value = {"model": "test-model", "cwd": cwd}

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


def test_build_agent_binds_session_cwd_during_init(tmp_path, monkeypatch):
    cwd = tmp_path / "project"
    cwd.mkdir()

    kw = _drive_build_agent(
        tmp_path,
        monkeypatch,
        provider="customx",
        resolved_base_url="https://api.example.com/v1",
        cwd=str(cwd),
    )

    assert kw["agent_workspace_cwd"] == str(cwd)
    assert kw["agent_session_cwd"] == str(cwd)
    assert kw["init_terminal_cwd"] == str(cwd)
    assert kw["init_agent_cwd"] == str(cwd)
    assert kw["init_context_cwd"] == str(cwd)
