"""Integration tests for /model endpoints — SQLite-backed overlays (v3)."""

from daemon.overlays.loader import update as overlay_update


def test_get_catalog(client, auth):
    r = client.get("/desktop/api/model/catalog", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["fetched_at"] == "2026-05-05T09:00:00Z"
    assert len(body["providers"]) == 2


def test_get_providers_default_visible(client, auth):
    r = client.get("/desktop/api/model/providers?configured_only=false", headers=auth)
    assert r.status_code == 200
    items = r.json()["items"]
    assert all(p["desktop"]["visible"] is True for p in items)


def test_providers_overlay_applied(client, auth, hermes_home):
    overlay_update(hermes_home, "model", "provider_test_openai",
                   {"visible": False, "api_key": "sk-test"})
    items = {
        p["id"]: p
        for p in client.get("/desktop/api/model/providers", headers=auth).json()[
            "items"
        ]
    }
    assert items["provider_test_openai"]["desktop"]["visible"] is False


def test_get_active_model_reads_config(client, auth, hermes_home):
    import yaml as _yaml

    (hermes_home / "config.yaml").write_text(
        _yaml.dump({"model": {"provider": "kimi-coding", "default": "kimi-k2.6"}})
    )
    r = client.get("/desktop/api/model/active", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "kimi-coding"
    assert body["model"] == "kimi-k2.6"


def test_get_active_model_no_config(client, auth, hermes_home):
    (hermes_home / "config.yaml").unlink(missing_ok=True)
    r = client.get("/desktop/api/model/active", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] is None
    assert body["model"] is None


def test_providers_configured_only_default(client, auth, hermes_home):
    overlay_update(hermes_home, "model", "provider_test_anthropic",
                   {"api_key": "sk-test"})
    items = client.get("/desktop/api/model/providers", headers=auth).json()["items"]
    ids = [p["id"] for p in items]
    assert "provider_test_anthropic" in ids
    assert "provider_test_openai" not in ids


def test_providers_configured_only_false_shows_all(client, auth):
    items = client.get(
        "/desktop/api/model/providers?configured_only=false", headers=auth
    ).json()["items"]
    ids = [p["id"] for p in items]
    assert "provider_test_anthropic" in ids
    assert "provider_test_openai" in ids
