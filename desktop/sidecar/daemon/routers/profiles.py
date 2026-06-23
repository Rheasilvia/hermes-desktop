"""Profile endpoints for Tauri desktop."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..services.dependencies import get_event_bus, get_profile_service
from ..services.profile_service import ProfileService

router = APIRouter(tags=["profiles"])


class ProfileCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    cloneFrom: str | None = None
    soul: str | None = None


class ProfileUpdateRequest(BaseModel):
    name: str | None = None
    soul: str | None = None
    isDefault: bool | None = None


class ActiveProfileUpdateRequest(BaseModel):
    profileId: str | None = None
    id: str | None = None
    name: str | None = None

    def requested_id(self) -> str:
        value = self.profileId or self.id or self.name
        if not value:
            raise ValueError("profileId is required")
        return value


class ProfileStateUpdateRequest(BaseModel):
    value: Any = None


def _http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, FileExistsError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=422, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.get("/profiles")
async def list_profiles(svc: ProfileService = Depends(get_profile_service)) -> dict[str, Any]:
    active = svc.get_active_profile_id()
    return {
        "profiles": svc.list_profiles(),
        "activeProfileId": active,
        "activeProfile": svc.get_profile(active),
    }


@router.get("/profiles/active")
async def get_active_profile(svc: ProfileService = Depends(get_profile_service)) -> dict[str, Any]:
    profile = svc.get_active_profile()
    return {"activeProfileId": profile["id"], "profile": profile}


@router.put("/profiles/active")
async def set_active_profile(
    request: Request,
    body: ActiveProfileUpdateRequest,
    svc: ProfileService = Depends(get_profile_service),
    bus=Depends(get_event_bus),
) -> dict[str, Any]:
    try:
        profile = svc.set_active_profile(body.requested_id())
    except Exception as exc:
        raise _http_error(exc)
    try:
        bus.publish(
            "",
            0,
            "profile.changed",
            {"profileId": profile["id"], "profile": profile},
        )
    except Exception:
        pass
    return {"ok": True, "activeProfileId": profile["id"], "profile": profile}


@router.post("/profiles")
async def create_profile(
    body: ProfileCreateRequest,
    svc: ProfileService = Depends(get_profile_service),
) -> dict[str, Any]:
    try:
        profile = svc.create_profile(
            name=body.name,
            clone_from=body.cloneFrom,
            soul=body.soul,
        )
    except Exception as exc:
        raise _http_error(exc)
    return {"profile": profile}


@router.patch("/profiles/{profile_id}")
async def update_profile(
    profile_id: str,
    body: ProfileUpdateRequest,
    svc: ProfileService = Depends(get_profile_service),
) -> dict[str, Any]:
    try:
        profile = svc.update_profile(
            profile_id,
            name=body.name,
            soul=body.soul,
            is_default=body.isDefault,
        )
    except Exception as exc:
        raise _http_error(exc)
    return {"profile": profile}


@router.delete("/profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    svc: ProfileService = Depends(get_profile_service),
) -> dict[str, Any]:
    try:
        svc.archive_profile(profile_id)
    except Exception as exc:
        raise _http_error(exc)
    return {"ok": True}


@router.get("/profiles/{profile_id}/state/{key}")
async def get_profile_state(
    profile_id: str,
    key: str,
    svc: ProfileService = Depends(get_profile_service),
) -> dict[str, Any]:
    try:
        return {"value": svc.get_profile_state(profile_id, key)}
    except Exception as exc:
        raise _http_error(exc)


@router.put("/profiles/{profile_id}/state/{key}")
async def set_profile_state(
    profile_id: str,
    key: str,
    body: ProfileStateUpdateRequest,
    svc: ProfileService = Depends(get_profile_service),
) -> dict[str, Any]:
    try:
        svc.set_profile_state(profile_id, key, body.value)
    except Exception as exc:
        raise _http_error(exc)
    return {"ok": True}


@router.get("/profiles/sessions")
async def list_profile_sessions(
    profile: str = Query("current"),
    archived: str = Query("exclude", pattern="^(exclude|only|include)$"),
    svc: ProfileService = Depends(get_profile_service),
) -> dict[str, Any]:
    try:
        return svc.list_profile_sessions(profile=profile, archived=archived)
    except Exception as exc:
        raise _http_error(exc)
