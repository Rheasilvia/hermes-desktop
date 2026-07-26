"""Unit tests for store/settings.py and store/state.py."""

import json
from pathlib import Path

import pytest

from daemon.db.schema import SCHEMA_VERSION as STATE_SCHEMA_VERSION
from daemon.store import settings as settings_store
from daemon.store import state as state_store
from daemon.store.settings import SchemaVersionMismatch

SETTINGS_SCHEMA_VERSION = settings_store.SCHEMA_VERSION  # 1 — independent from db migration version


def test_settings_load_returns_defaults_when_missing(tmp_path):
    out = settings_store.load(tmp_path)
    assert out["schema_version"] == SETTINGS_SCHEMA_VERSION
    assert "ui" in out
    assert out["desktop_sandbox"] == {
        "mode": "workspace-write",
        "network_access": "restricted",
    }


def test_settings_save_roundtrip(tmp_path):
    payload = {
        "schema_version": SETTINGS_SCHEMA_VERSION,
        "ui": {"theme": "dark"},
        "desktop_sandbox": {"mode": "read-only", "network_access": "enabled"},
    }
    settings_store.save(tmp_path, payload)
    out = settings_store.load(tmp_path)
    assert out["ui"]["theme"] == "dark"
    assert out["desktop_sandbox"] == {
        "mode": "read-only",
        "network_access": "enabled",
    }


def test_settings_save_rejects_wrong_schema(tmp_path):
    with pytest.raises(SchemaVersionMismatch):
        settings_store.save(tmp_path, {"schema_version": 999, "ui": {}})


def test_state_load_defaults(tmp_path):
    out = state_store.load(tmp_path)
    assert out["schema_version"] == STATE_SCHEMA_VERSION
    assert "last_open_route" in out


def test_state_save_roundtrip(tmp_path):
    payload = {"schema_version": STATE_SCHEMA_VERSION, "last_open_route": "/cron"}
    state_store.save(tmp_path, payload)
    assert state_store.load(tmp_path)["last_open_route"] == "/cron"
