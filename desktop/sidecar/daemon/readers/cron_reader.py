# SNAPSHOT:
#   source: cron/jobs.py
#   upstream_sha: 69e4387e527e45fcd715dab02e4c3857872e1641
#   copied_at: 2026-05-05
#   stripped:
#     - CLI entry points (argparse, click)
#     - logging configuration (use stdlib logging in sidecar)
#     - mutation helpers (add_job / update_job / delete_job)
#     - scheduler runtime (we only read the persisted file)
#   resync_when:
#     - upstream `jobs.json` schema adds new required fields
#     - upstream renames the cron directory or filename
"""Pure read-only parser for ~/.hermes/cron/jobs.json."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

CRON_FILE = "cron/jobs.json"


class L1CorruptError(RuntimeError):
    def __init__(self, path: str, detail: str):
        super().__init__(f"L1 corrupt: {path}: {detail}")
        self.path = path
        self.detail = detail


def _file(hermes_home: Path) -> Path:
    return Path(hermes_home) / CRON_FILE


def load_jobs(hermes_home: Path) -> list[dict[str, Any]]:
    path = _file(hermes_home)
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except json.JSONDecodeError as exc:
        raise L1CorruptError(str(path), str(exc)) from exc
    jobs = payload.get("jobs") if isinstance(payload, dict) else None
    if not isinstance(jobs, list):
        raise L1CorruptError(str(path), "expected 'jobs' to be a list")
    return jobs


def get_job(hermes_home: Path, job_id: str) -> Optional[dict[str, Any]]:
    for job in load_jobs(hermes_home):
        if job.get("id") == job_id:
            return job
    return None
