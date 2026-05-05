import json
from pathlib import Path

import pytest

from desktop_backend.store import settings as settings_store
from desktop_backend.store import state as state_store
from desktop_backend.store.settings import SchemaVersionMismatch, SCHEMA_VERSION


def test_settings_load_returns_defaults_when_missing(tmp_path):
    out = settings_store.load(tmp_path)
    assert out["schema_version"] == SCHEMA_VERSION
    assert "ui" in out


def test_settings_save_roundtrip(tmp_path):
    payload = {"schema_version": SCHEMA_VERSION, "ui": {"theme": "dark"}}
    settings_store.save(tmp_path, payload)
    assert settings_store.load(tmp_path)["ui"]["theme"] == "dark"


def test_settings_save_rejects_wrong_schema(tmp_path):
    with pytest.raises(SchemaVersionMismatch):
        settings_store.save(tmp_path, {"schema_version": 999, "ui": {}})


def test_state_load_defaults(tmp_path):
    out = state_store.load(tmp_path)
    assert out["schema_version"] == SCHEMA_VERSION
    assert "last_open_route" in out


def test_state_save_roundtrip(tmp_path):
    payload = {"schema_version": SCHEMA_VERSION, "last_open_route": "/cron"}
    state_store.save(tmp_path, payload)
    assert state_store.load(tmp_path)["last_open_route"] == "/cron"
