"""Unit tests for config.py — matches current load_config() API (env-var driven)."""

from pathlib import Path

from desktop_backend.config import load_config


def test_load_config_uses_default_hermes_home(monkeypatch, tmp_path):
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.delenv("DESKTOP_BACKEND_PORT", raising=False)
    monkeypatch.delenv("DESKTOP_BACKEND_TOKEN", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    cfg = load_config()
    assert cfg.hermes_home == tmp_path / ".hermes"
    assert cfg.bind_host == "127.0.0.1"
    assert cfg.port == 18080
    assert cfg.token is None


def test_load_config_respects_hermes_home_env(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "alt"))
    monkeypatch.delenv("DESKTOP_BACKEND_PORT", raising=False)
    monkeypatch.delenv("DESKTOP_BACKEND_TOKEN", raising=False)
    cfg = load_config()
    assert cfg.hermes_home == tmp_path / "alt"


def test_load_config_respects_port_env(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("DESKTOP_BACKEND_PORT", "18081")
    monkeypatch.delenv("DESKTOP_BACKEND_TOKEN", raising=False)
    cfg = load_config()
    assert cfg.port == 18081


def test_load_config_respects_token_env(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("DESKTOP_BACKEND_TOKEN", "my-test-token")
    cfg = load_config()
    assert cfg.token == "my-test-token"


def test_load_config_token_none_when_not_set(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.delenv("DESKTOP_BACKEND_TOKEN", raising=False)
    cfg = load_config()
    assert cfg.token is None
