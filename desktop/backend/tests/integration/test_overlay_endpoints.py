"""Integration tests for /overlays endpoints — SQLite-backed (v3)."""

from desktop_backend.overlays.loader import load


def test_patch_overlay_via_http(client, auth, hermes_home):
    r = client.patch(
        "/desktop/api/overlays/cron/job_test_001",
        json={"pinned": True},
        headers=auth,
    )
    assert r.status_code == 200
    assert r.json()["pinned"] is True
    result = load(hermes_home, "cron")
    assert result["job_test_001"]["pinned"] == 1  # SQLite stores bool as int


def test_patch_overlay_for_unknown_l1_still_succeeds(client, auth):
    r = client.patch(
        "/desktop/api/overlays/cron/never_seen",
        json={"pinned": True},
        headers=auth,
    )
    assert r.status_code == 200


def test_patch_overlay_unknown_domain_rejected(client, auth):
    r = client.patch(
        "/desktop/api/overlays/whatever/x",
        json={"pinned": True},
        headers=auth,
    )
    assert r.status_code == 404


def test_patch_overlay_invalid_body(client, auth):
    r = client.patch(
        "/desktop/api/overlays/cron/job_test_001",
        json="not-an-object",
        headers=auth,
    )
    assert r.status_code == 422
