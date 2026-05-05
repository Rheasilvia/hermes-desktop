import os
from pathlib import Path
import pytest

from desktop_backend.config import Config, ConfigError, load_config


def test_load_config_uses_default_hermes_home(monkeypatch, tmp_path):
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    cfg = load_config(require_token=False)
    assert cfg.hermes_home == tmp_path / ".hermes"
    assert cfg.token_file == tmp_path / ".hermes" / "desktop" / "sidecar.token"
    assert cfg.bind_host == "127.0.0.1"


def test_load_config_respects_hermes_home_env(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "alt"))
    cfg = load_config(require_token=False)
    assert cfg.hermes_home == tmp_path / "alt"


def test_load_config_requires_token_when_asked(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    (tmp_path / ".hermes" / "desktop").mkdir(parents=True)
    token_file = tmp_path / ".hermes" / "desktop" / "sidecar.token"
    token_file.write_text("abc123")
    os.chmod(token_file, 0o600)
    cfg = load_config(require_token=True)
    assert cfg.token == "abc123"


def test_load_config_token_missing_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    (tmp_path / ".hermes" / "desktop").mkdir(parents=True)
    with pytest.raises(ConfigError):
        load_config(require_token=True)


def test_load_config_token_bad_perm_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    (tmp_path / ".hermes" / "desktop").mkdir(parents=True)
    token_file = tmp_path / ".hermes" / "desktop" / "sidecar.token"
    token_file.write_text("abc123")
    os.chmod(token_file, 0o644)  # too permissive
    with pytest.raises(ConfigError):
        load_config(require_token=True)
