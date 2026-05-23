from desktop_backend.schemas.model import MergedProvider, ProviderOverlay
from desktop_backend.services.merger import filter_configured, merge_cron_jobs, merge_providers


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


def test_filter_configured_keeps_providers_with_credentials():
    providers = [
        MergedProvider(id="a", name="A", desktop=ProviderOverlay(api_key="sk-123"), has_overlay=True),
        MergedProvider(id="b", name="B", desktop=ProviderOverlay(api_key_env="MY_KEY"), has_overlay=True),
        MergedProvider(id="c", name="C", desktop=ProviderOverlay(base_url="http://localhost"), has_overlay=True),
        MergedProvider(id="d", name="D", desktop=ProviderOverlay(), has_overlay=True),
        MergedProvider(id="e", name="E", desktop=ProviderOverlay(api_key=""), has_overlay=True),
    ]
    result = filter_configured(providers)
    assert [p.id for p in result] == ["a", "b", "c"]


def test_filter_configured_empty_list():
    assert filter_configured([]) == []
