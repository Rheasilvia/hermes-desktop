from desktop_backend.services.merger import merge_cron_jobs, merge_providers


JOBS = [
    {
        "id": "job_test_001",
        "schedule": "0 9 * * *",
        "prompt": "p",
        "enabled": True,
        "created_at": "2026-05-05T09:00:00Z",
    },
    {
        "id": "job_test_002",
        "schedule": "*/5 * * * *",
        "prompt": "q",
        "enabled": False,
        "created_at": "2026-05-05T09:00:00Z",
    },
]


def test_merge_cron_jobs_default_overlay():
    out = merge_cron_jobs(JOBS, {})
    assert all(j.desktop.pinned is False for j in out)
    assert [j.id for j in out] == ["job_test_001", "job_test_002"]


def test_merge_cron_jobs_applies_overlay():
    overlay = {"job_test_001": {"pinned": True, "color": "red"}}
    out = merge_cron_jobs(JOBS, overlay)
    assert out[0].desktop.pinned is True
    assert out[0].desktop.color == "red"
    assert out[1].desktop.pinned is False


def test_merge_cron_jobs_drops_orphan_overlay():
    overlay = {"orphan_id": {"pinned": True}}
    out = merge_cron_jobs(JOBS, overlay)
    ids = {j.id for j in out}
    assert "orphan_id" not in ids


def test_merge_providers_default_visible():
    providers = [{"id": "p1", "name": "P1", "models": []}]
    out = merge_providers(providers, {})
    assert out[0].desktop.visible is True
