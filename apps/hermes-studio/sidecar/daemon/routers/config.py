from __future__ import annotations

from fastapi import APIRouter, Request

from ..schemas.config import ConfigReadResponse, ConfigSaveRequest, ConfigSaveResponse
from ..services.config_service import ConfigService
from ..services.dependencies import get_active_hermes_home

router = APIRouter(tags=["config"])


def _service(request: Request) -> ConfigService:
    return ConfigService(get_active_hermes_home(request))


@router.get("/config", response_model=ConfigReadResponse)
def get_config(request: Request) -> dict:
    return _service(request).get_config()


@router.get("/config/defaults")
def get_config_defaults(request: Request) -> dict:
    return _service(request).get_defaults()


@router.get("/config/schema")
def get_config_schema(request: Request) -> dict:
    return _service(request).get_schema()


@router.put("/config", response_model=ConfigSaveResponse)
async def put_config(request: Request, payload: ConfigSaveRequest) -> dict:
    return _service(request).save_config(
        payload.config,
        changed_paths=payload.changed_paths,
    )
