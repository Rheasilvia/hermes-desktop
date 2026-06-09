"""Model endpoints — active model, catalog, provider CRUD, API key reveal.

All business logic is delegated to ModelService injected via FastAPI Depends().
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..schemas.model import (
    AuxiliaryModelsResponse,
    ModelAssignmentRequest,
    ModelAssignmentResponse,
    SetActiveModelRequest,
    UpsertProviderRequest,
)
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
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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


@router.get("/model/providers/{provider_id}/models-config")
def get_provider_models_config(provider_id: str, svc=Depends(get_model_service)):
    """Return the models_config JSON blob for a provider (per-model params/enabled)."""
    return svc.get_models_config(provider_id)


@router.post("/model/providers/{provider_id}/models/{model_id}/params")
def set_model_params(
    provider_id: str,
    model_id: str,
    body: dict,
    svc=Depends(get_model_service),
):
    """Persist per-model parameter overrides (temperature, max_tokens, capabilities)."""
    try:
        svc.set_model_params(provider_id, model_id, body)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"ok": True}


@router.get("/model/auxiliary", response_model=AuxiliaryModelsResponse)
def get_auxiliary_models(svc=Depends(get_model_service)):
    """Return current auxiliary task model assignments."""
    try:
        return svc.get_auxiliary_models()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/model/assignment", response_model=ModelAssignmentResponse)
def set_model_assignment(body: ModelAssignmentRequest, svc=Depends(get_model_service)):
    """Assign a provider/model to the main slot or an auxiliary task slot."""
    scope = (body.scope or "").strip().lower()
    if scope not in {"main", "auxiliary"}:
        raise HTTPException(status_code=400, detail="scope must be 'main' or 'auxiliary'")
    try:
        result = svc.set_model_assignment(
            scope=scope,
            provider=(body.provider or "").strip(),
            model=(body.model or "").strip(),
            task=(body.task or "").strip().lower(),
            base_url=(body.base_url or "").strip(),
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
