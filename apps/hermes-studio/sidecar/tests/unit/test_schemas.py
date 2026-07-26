from daemon.schemas.cron import CronOverlay, MergedCronJob
from daemon.schemas.error import ErrorEnvelope
from daemon.schemas.model import MergedProvider, ProviderOverlay


def test_cron_overlay_defaults():
    o = CronOverlay()
    assert o.pinned is False
    assert o.color is None


def test_merged_cron_job_round_trip():
    j = MergedCronJob(
        id="job_test_001",
        schedule="0 9 * * *",
        prompt="x",
        enabled=True,
        created_at="2026-05-05T09:00:00Z",
        desktop=CronOverlay(pinned=True),
    )
    assert j.desktop.pinned is True


def test_error_envelope_minimal():
    e = ErrorEnvelope(code="L1_CORRUPT", domain="cron", trace_id="t1")
    payload = e.model_dump(exclude_none=True)
    assert payload == {"code": "L1_CORRUPT", "domain": "cron", "trace_id": "t1"}


def test_provider_overlay_defaults():
    assert ProviderOverlay().visible is True
    assert ProviderOverlay().display_order is None
