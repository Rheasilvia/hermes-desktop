import json


def test_list_jobs_default_overlay(client, auth):
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert {j["id"] for j in body["items"]} == {"job_test_001", "job_test_002"}
    assert all(j["desktop"]["pinned"] is False for j in body["items"])


def test_list_jobs_applies_overlay(client, auth, hermes_home):
    overlay_dir = hermes_home / "desktop" / "overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    (overlay_dir / "cron.json").write_text(
        json.dumps({"job_test_001": {"pinned": True}})
    )
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    items = {j["id"]: j for j in r.json()["items"]}
    assert items["job_test_001"]["desktop"]["pinned"] is True


def test_get_job_404(client, auth):
    r = client.get("/desktop/api/cron/jobs/nope", headers=auth)
    assert r.status_code == 404
    assert r.json()["code"] == "NOT_FOUND"


def test_get_job_200(client, auth):
    r = client.get("/desktop/api/cron/jobs/job_test_001", headers=auth)
    assert r.status_code == 200
    assert r.json()["id"] == "job_test_001"


def test_corrupt_l1_returns_503(client, auth, hermes_home):
    (hermes_home / "cron" / "jobs.json").write_text("not-json")
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    assert r.status_code == 503
    body = r.json()
    assert body["code"] == "L1_CORRUPT"
    assert body["path"].endswith("jobs.json")


def test_corrupt_l2_does_not_block_l1(client, auth, hermes_home):
    overlay_dir = hermes_home / "desktop" / "overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    (overlay_dir / "cron.json").write_text("garbage")
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    assert r.status_code == 200
    backups = list(overlay_dir.glob("cron.json.corrupt-*"))
    assert len(backups) == 1
