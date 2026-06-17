# daemon/routers/cron.py
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request

from ..schemas.cron import CreateCronJobRequest, UpdateCronJobRequest
from ..services.cron_service import CronService

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _service(request: Request) -> CronService:
    return CronService(request.app.state.cfg.hermes_home)


@router.get("/cron/jobs")
def list_jobs(request: Request):
    merged = _service(request).list_jobs()
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }


@router.get("/cron/jobs/{job_id}")
def get_job(job_id: str, request: Request):
    return _service(request).get_job(job_id).model_dump()


@router.post("/cron/jobs")
def create_job(body: CreateCronJobRequest, request: Request):
    return _service(request).create_job(body).model_dump()


@router.patch("/cron/jobs/{job_id}")
def update_job(job_id: str, body: UpdateCronJobRequest, request: Request):
    return _service(request).update_job(job_id, body).model_dump()


@router.delete("/cron/jobs/{job_id}")
def delete_job(job_id: str, request: Request):
    _service(request).delete_job(job_id)
    return {"ok": True}
