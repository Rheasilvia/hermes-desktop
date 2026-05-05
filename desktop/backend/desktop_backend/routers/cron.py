from fastapi import APIRouter

router = APIRouter()


@router.get("/cron/jobs")
def list_jobs():
    return {"items": [], "generated_at": None}
