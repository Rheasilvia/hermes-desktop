# desktop_backend/routers/cron.py
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from ..overlays import loader as overlays_loader
from ..readers import cron_reader
from ..services.merger import merge_cron_jobs

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/cron/jobs")
def list_jobs(request: Request):
    cfg = request.app.state.cfg
    jobs = cron_reader.load_jobs(cfg.hermes_home)
    overlay = overlays_loader.load(cfg.hermes_home, "cron")
    merged = merge_cron_jobs(jobs, overlay)
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }


@router.get("/cron/jobs/{job_id}")
def get_job(job_id: str, request: Request):
    cfg = request.app.state.cfg
    job = cron_reader.get_job(cfg.hermes_home, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    overlay = overlays_loader.load(cfg.hermes_home, "cron")
    merged = merge_cron_jobs([job], overlay)[0]
    return merged.model_dump()
