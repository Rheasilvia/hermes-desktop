"""Model endpoints — active model, catalog, provider CRUD, API key reveal.

All business logic is delegated to ModelService injected via FastAPI Depends().
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..schemas.model import SetActiveModelRequest, UpsertProviderRequest
from ..services.dependencies import get_model_service
from ..services.exceptions import ProviderNotFoundError

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/model/active")
def get_active_model(svc=Depends(get_model_service)):
    return svc.get_active_model()


@router.put("/model/active")
def set_active_model(body: SetActiveModelRequest, svc=Depends(get_model_service)):
    try:
        svc.set_active_model(body.provider, body.model)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"provider": body.provider, "model": body.model}


@router.get("/model/catalog")
def get_catalog(svc=Depends(get_model_service)):
    return svc.get_catalog()


@router.get("/model/providers")
def list_providers(
    configured_only: bool = Query(default=True),
    svc=Depends(get_model_service),
):
    return svc.list_providers(configured_only=configured_only)


@router.post("/model/providers")
def upsert_provider(body: UpsertProviderRequest, svc=Depends(get_model_service)):
    return svc.upsert_provider(body)


@router.delete("/model/providers/{provider_id}")
def delete_provider(provider_id: str, svc=Depends(get_model_service)):
    try:
        svc.delete_provider(provider_id)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/model/providers/{provider_id}/api-key/reveal")
def reveal_provider_api_key(provider_id: str, svc=Depends(get_model_service)):
    try:
        return svc.reveal_api_key(provider_id)
    except ProviderNotFoundError:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
