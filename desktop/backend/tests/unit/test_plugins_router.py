"""Unit tests for the plugins router — service layer is mocked."""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from desktop_backend.app import build_app
from desktop_backend.config import Config

AUTH = {"Authorization": "Bearer test-token"}
SVC = "desktop_backend.routers.plugins.svc"

EMPTY_HUB = {
    "plugins": [],
    "orphan_dashboard_plugins": [],
    "providers": {
        "memory_provider": "",
        "memory_options": [],
        "context_engine": None,
        "context_options": [],
    },
}


@pytest.fixture
def client(tmp_path):
    cfg = Config(
        hermes_home=tmp_path,
        bind_host="127.0.0.1",
        token="test-token",
    )
    return TestClient(build_app(cfg))


# ─── GET /plugins/hub ───────────────────────────────────────────────────────

def test_get_hub_returns_hub(client):
    with patch(f"{SVC}.get_plugins_hub", return_value=EMPTY_HUB) as m:
        r = client.get("/desktop/api/plugins/hub", headers=AUTH)
    assert r.status_code == 200
    assert r.json()["plugins"] == []
    m.assert_called_once_with(force_rescan=False)


def test_get_hub_rescan_flag(client):
    with patch(f"{SVC}.get_plugins_hub", return_value=EMPTY_HUB) as m:
        r = client.get("/desktop/api/plugins/hub?rescan=true", headers=AUTH)
    assert r.status_code == 200
    m.assert_called_once_with(force_rescan=True)


def test_get_hub_500_on_exception(client):
    with patch(f"{SVC}.get_plugins_hub", side_effect=RuntimeError("boom")):
        r = client.get("/desktop/api/plugins/hub", headers=AUTH)
    assert r.status_code == 500


# ─── GET /plugins/rescan ────────────────────────────────────────────────────

def test_rescan_ok(client):
    with patch(f"{SVC}.rescan_plugins", return_value={"ok": True, "count": 3}) as m:
        r = client.get("/desktop/api/plugins/rescan", headers=AUTH)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "count": 3}
    m.assert_called_once()


# ─── POST /plugins/install ──────────────────────────────────────────────────

def test_install_ok(client):
    with patch(f"{SVC}.install_plugin", return_value={"ok": True}) as m:
        r = client.post(
            "/desktop/api/plugins/install",
            json={"identifier": "owner/repo", "force": False, "enable": True},
            headers=AUTH,
        )
    assert r.status_code == 200
    m.assert_called_once_with("owner/repo", force=False, enable=True)


def test_install_400_on_failure(client):
    with patch(f"{SVC}.install_plugin", return_value={"ok": False, "error": "not found"}):
        r = client.post(
            "/desktop/api/plugins/install",
            json={"identifier": "bad/repo"},
            headers=AUTH,
        )
    assert r.status_code == 400


# ─── POST /plugins/{name}/enable ────────────────────────────────────────────

def test_enable_ok(client):
    with patch(f"{SVC}.set_plugin_enabled", return_value={"ok": True}) as m:
        r = client.post("/desktop/api/plugins/my-plugin/enable", headers=AUTH)
    assert r.status_code == 200
    m.assert_called_once_with("my-plugin", enabled=True)


# ─── POST /plugins/{name}/disable ───────────────────────────────────────────

def test_disable_ok(client):
    with patch(f"{SVC}.set_plugin_enabled", return_value={"ok": True}) as m:
        r = client.post("/desktop/api/plugins/my-plugin/disable", headers=AUTH)
    assert r.status_code == 200
    m.assert_called_once_with("my-plugin", enabled=False)


# ─── POST /plugins/{name}/update ────────────────────────────────────────────

def test_update_ok(client):
    with patch(f"{SVC}.update_plugin", return_value={"ok": True}) as m:
        r = client.post("/desktop/api/plugins/my-plugin/update", headers=AUTH)
    assert r.status_code == 200
    m.assert_called_once_with("my-plugin")


# ─── DELETE /plugins/{name} ─────────────────────────────────────────────────

def test_remove_ok(client):
    with patch(f"{SVC}.remove_plugin", return_value={"ok": True}) as m:
        r = client.delete("/desktop/api/plugins/my-plugin", headers=AUTH)
    assert r.status_code == 200
    m.assert_called_once_with("my-plugin")


def test_remove_400_on_failure(client):
    with patch(f"{SVC}.remove_plugin", return_value={"ok": False, "error": "protected"}):
        r = client.delete("/desktop/api/plugins/my-plugin", headers=AUTH)
    assert r.status_code == 400


# ─── PUT /plugins/providers ─────────────────────────────────────────────────

def test_save_providers_ok(client):
    with patch(f"{SVC}.save_plugin_providers", return_value={"ok": True}) as m:
        r = client.put(
            "/desktop/api/plugins/providers",
            json={"memory_provider": "mem-plugin", "context_engine": None},
            headers=AUTH,
        )
    assert r.status_code == 200
    m.assert_called_once_with("mem-plugin", None)


# ─── PUT /plugins/{name}/visibility ─────────────────────────────────────────

def test_set_visibility_ok(client):
    with patch(f"{SVC}.set_plugin_visibility", return_value={"ok": True, "name": "p", "hidden": True}) as m:
        r = client.put(
            "/desktop/api/plugins/my-plugin/visibility",
            json={"hidden": True},
            headers=AUTH,
        )
    assert r.status_code == 200
    m.assert_called_once_with("my-plugin", True)


# ─── Auth guard ─────────────────────────────────────────────────────────────

def test_hub_requires_auth(client):
    with patch(f"{SVC}.get_plugins_hub", return_value=EMPTY_HUB):
        r = client.get("/desktop/api/plugins/hub")
    assert r.status_code == 401
