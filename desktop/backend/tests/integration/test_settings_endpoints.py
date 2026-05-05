"""Integration tests for /settings and /state endpoints."""
from __future__ import annotations


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
    assert r.json()["schema_version"] == 1


def test_put_state_round_trip(client, auth):
    r = client.put(
        "/desktop/api/state",
        json={"schema_version": 1, "last_open_route": "/cron"},
        headers=auth,
    )
    assert r.status_code == 200
    r2 = client.get("/desktop/api/state", headers=auth)
    assert r2.json()["last_open_route"] == "/cron"
