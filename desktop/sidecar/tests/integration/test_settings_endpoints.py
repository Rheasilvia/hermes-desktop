"""Integration tests for /settings and /state endpoints."""
from __future__ import annotations

from daemon.db.schema import SCHEMA_VERSION as STATE_SCHEMA_VERSION


def test_get_settings_defaults(client, auth):
    r = client.get("/desktop/api/settings", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["schema_version"] == 1
    assert "ui" in body


def test_put_settings_round_trip(client, auth):
    payload = {"schema_version": 1, "ui": {"theme": "dark"}}
    r = client.put("/desktop/api/settings", json=payload, headers=auth)
    assert r.status_code == 200
    r2 = client.get("/desktop/api/settings", headers=auth)
    assert r2.json()["ui"]["theme"] == "dark"


def test_put_settings_rejects_runtime_config_keys(client, auth):
    for key in ("tts", "stt", "voice", "model", "agent", "security", "memory", "browser"):
        r = client.put(
            "/desktop/api/settings",
            json={"schema_version": 1, "ui": {}, key: {"enabled": True}},
            headers=auth,
        )
        assert r.status_code == 400
        assert r.json()["detail"] == f"Runtime config key '{key}' belongs in /desktop/api/config"


def test_put_settings_schema_mismatch(client, auth):
    r = client.put(
        "/desktop/api/settings",
        json={"schema_version": 999, "ui": {}},
        headers=auth,
    )
    assert r.status_code == 409
    assert r.json()["code"] == "SCHEMA_VERSION"


def test_get_state_defaults(client, auth):
    r = client.get("/desktop/api/state", headers=auth)
    assert r.status_code == 200
    assert r.json()["schema_version"] == STATE_SCHEMA_VERSION


def test_put_state_round_trip(client, auth):
    r = client.put(
        "/desktop/api/state",
        json={"schema_version": STATE_SCHEMA_VERSION, "last_open_route": "/cron"},
        headers=auth,
    )
    assert r.status_code == 200
    r2 = client.get("/desktop/api/state", headers=auth)
    assert r2.json()["last_open_route"] == "/cron"
