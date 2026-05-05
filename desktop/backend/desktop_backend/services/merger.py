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
        merged.append(
            MergedCronJob(
                id=job["id"],
                schedule=job["schedule"],
                prompt=job["prompt"],
                enabled=bool(job.get("enabled", True)),
                created_at=job.get("created_at", ""),
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
