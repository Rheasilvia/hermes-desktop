from __future__ import annotations


def test_get_catalog(client, auth):
    r = client.get("/desktop/api/model/catalog", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["fetched_at"] == "2026-05-05T09:00:00Z"
    assert len(body["providers"]) == 2


def test_get_providers_default_visible(client, auth):
    r = client.get("/desktop/api/model/providers", headers=auth)
    assert r.status_code == 200
    items = r.json()["items"]
    assert all(p["desktop"]["visible"] is True for p in items)


def test_providers_overlay_applied(client, auth, hermes_home):
    import json as _json

    od = hermes_home / "desktop" / "overlays"
    od.mkdir(parents=True, exist_ok=True)
    (od / "model.json").write_text(
        _json.dumps({"provider_test_openai": {"visible": False}})
    )
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
