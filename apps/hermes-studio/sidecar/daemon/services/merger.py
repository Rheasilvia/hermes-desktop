"""Merge L1 read-models with L2 overlays. Returns Pydantic models."""
from __future__ import annotations

from typing import Any

from ..schemas.cron import CronOverlay, MergedCronJob
from ..schemas.model import MergedProvider, ProviderOverlay


def merge_cron_jobs(
    jobs: list[dict[str, Any]],
    overlay: dict[str, dict[str, Any]],
) -> list[MergedCronJob]:
    merged: list[MergedCronJob] = []
    for job in jobs:
        entry = overlay.get(job.get("id", ""), {})
        schedule = job.get("schedule")
        schedule_expr = schedule if isinstance(schedule, str) else schedule.get("expr", "")
        merged.append(
            MergedCronJob(
                id=job["id"],
                schedule=schedule_expr,
                prompt=job.get("prompt", ""),
                enabled=bool(job.get("enabled", True)),
                created_at=job.get("created_at", ""),
                name=job.get("name"),
                skills=job.get("skills") or ([job["skill"]] if job.get("skill") else []),
                skill=job.get("skill"),
                model=job.get("model"),
                provider=job.get("provider"),
                base_url=job.get("base_url"),
                script=job.get("script"),
                schedule_display=job.get("schedule_display"),
                repeat=job.get("repeat"),
                state=job.get("state"),
                paused_at=job.get("paused_at"),
                paused_reason=job.get("paused_reason"),
                next_run_at=job.get("next_run_at"),
                last_run_at=job.get("last_run_at"),
                last_status=job.get("last_status"),
                last_error=job.get("last_error"),
                last_delivery_error=job.get("last_delivery_error"),
                deliver=job.get("deliver"),
                origin=job.get("origin"),
                desktop=CronOverlay(**entry),
            )
        )
    return merged


def merge_providers(
    providers: list[dict[str, Any]],
    overlay: dict[str, dict[str, Any]],
) -> list[MergedProvider]:
    merged: list[MergedProvider] = []
    for prov in providers:
        entry = overlay.get(prov.get("id", ""), {})
        merged.append(
            MergedProvider(
                id=prov["id"],
                name=prov.get("name", prov["id"]),
                auth=prov.get("auth"),
                models=prov.get("models", []),
                desktop=ProviderOverlay(**entry),
            )
        )
    return merged


def filter_configured(providers: list[MergedProvider]) -> list[MergedProvider]:
    def _has_creds(p: MergedProvider) -> bool:
        d = p.desktop
        return bool(
            d.api_key_set
            or (d.api_key and d.api_key.strip())
            or (d.api_key_env and d.api_key_env.strip())
            or (
                d.base_url
                and d.base_url.strip()
                and d.base_url_source != "provider-default"
            )
        )

    return [p for p in providers if _has_creds(p)]
