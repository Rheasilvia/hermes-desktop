import json


def test_patch_overlay_creates_file(client, auth, hermes_home):
    r = client.patch(
        "/desktop/api/overlays/cron/job_test_001",
        json={"pinned": True},
        headers=auth,
    )
    assert r.status_code == 200
    assert r.json()["pinned"] is True
    payload = json.loads(
        (hermes_home / "desktop" / "overlays" / "cron.json").read_text()
    )
    assert payload["job_test_001"]["pinned"] is True


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
