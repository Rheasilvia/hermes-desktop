from __future__ import annotations

import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from ..overlays import loader as overlays_loader
from ..readers import cron_reader
from ..schemas.cron import CreateCronJobRequest, MergedCronJob, UpdateCronJobRequest
from .exceptions import CronJobNotFoundError, CronValidationError
from .merger import merge_cron_jobs

_CRON_MODULE_LOCK = threading.RLock()


@contextmanager
def _cron_jobs_scope(hermes_home: Path) -> Iterator[Any]:
    """Point cron.jobs module globals at the sidecar profile while mutating."""
    import cron.jobs as cron_jobs

    with _CRON_MODULE_LOCK:
        old = {
            "HERMES_DIR": cron_jobs.HERMES_DIR,
            "CRON_DIR": cron_jobs.CRON_DIR,
            "JOBS_FILE": cron_jobs.JOBS_FILE,
            "OUTPUT_DIR": cron_jobs.OUTPUT_DIR,
        }
        cron_jobs.HERMES_DIR = hermes_home.resolve()
        cron_jobs.CRON_DIR = cron_jobs.HERMES_DIR / "cron"
        cron_jobs.JOBS_FILE = cron_jobs.CRON_DIR / "jobs.json"
        cron_jobs.OUTPUT_DIR = cron_jobs.CRON_DIR / "output"
        try:
            yield cron_jobs
        finally:
            cron_jobs.HERMES_DIR = old["HERMES_DIR"]
            cron_jobs.CRON_DIR = old["CRON_DIR"]
            cron_jobs.JOBS_FILE = old["JOBS_FILE"]
            cron_jobs.OUTPUT_DIR = old["OUTPUT_DIR"]


def _merge_one(hermes_home: Path, job: dict[str, Any]) -> MergedCronJob:
    overlay = overlays_loader.load(hermes_home, "cron")
    return merge_cron_jobs([job], overlay)[0]


class CronService:
    def __init__(self, hermes_home: Path):
        self._hermes_home = hermes_home

    def list_jobs(self) -> list[MergedCronJob]:
        jobs = cron_reader.load_jobs(self._hermes_home)
        overlay = overlays_loader.load(self._hermes_home, "cron")
        return merge_cron_jobs(jobs, overlay)

    def get_job(self, job_id: str) -> MergedCronJob:
        job = cron_reader.get_job(self._hermes_home, job_id)
        if job is None:
            raise CronJobNotFoundError(f"Cron job not found: {job_id}")
        return _merge_one(self._hermes_home, job)

    def create_job(self, body: CreateCronJobRequest) -> MergedCronJob:
        try:
            with _cron_jobs_scope(self._hermes_home) as cron_jobs:
                job = cron_jobs.create_job(**body.model_dump(exclude_none=True))
        except ValueError as exc:
            raise CronValidationError(str(exc)) from exc
        except RuntimeError as exc:
            raise CronValidationError(str(exc)) from exc
        return _merge_one(self._hermes_home, job)

    def update_job(self, job_id: str, body: UpdateCronJobRequest) -> MergedCronJob:
        updates = body.model_dump(exclude_unset=True)
        if "enabled" in updates:
            enabled = bool(updates.pop("enabled"))
            updates.update(
                {
                    "enabled": enabled,
                    "state": "scheduled" if enabled else "paused",
                    "paused_at": None if enabled else body.paused_at,
                    "paused_reason": None if enabled else body.paused_reason or "Paused by desktop",
                }
            )
        try:
            with _cron_jobs_scope(self._hermes_home) as cron_jobs:
                if "repeat" in updates:
                    current = cron_jobs.get_job(job_id)
                    if current is None:
                        raise CronJobNotFoundError(f"Cron job not found: {job_id}")
                    completed = (current.get("repeat") or {}).get("completed", 0)
                    times = updates["repeat"]
                    updates["repeat"] = {
                        "times": times if isinstance(times, int) and times > 0 else None,
                        "completed": completed,
                    }
                job = cron_jobs.update_job(job_id, updates)
        except ValueError as exc:
            raise CronValidationError(str(exc)) from exc
        except RuntimeError as exc:
            raise CronValidationError(str(exc)) from exc
        if job is None:
            raise CronJobNotFoundError(f"Cron job not found: {job_id}")
        return _merge_one(self._hermes_home, job)

    def delete_job(self, job_id: str) -> None:
        try:
            with _cron_jobs_scope(self._hermes_home) as cron_jobs:
                ok = cron_jobs.remove_job(job_id)
        except ValueError as exc:
            raise CronValidationError(str(exc)) from exc
        except RuntimeError as exc:
            raise CronValidationError(str(exc)) from exc
        if not ok:
            raise CronJobNotFoundError(f"Cron job not found: {job_id}")
