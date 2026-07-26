from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .schemas import (
    PluginInstallRequest,
    PluginProvidersRequest,
    PluginVisibilityRequest,
)
from . import service as svc

router = APIRouter()


def _ok_or_400(result: dict) -> dict:
    if not result.get("ok"):
        raise HTTPException(status_code=400, detail=result.get("error") or "Operation failed.")
    return result


@router.get("/plugins/hub")
def get_hub(rescan: bool = False) -> dict:
    try:
        return svc.get_plugins_hub(force_rescan=rescan)
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to build plugins hub.") from exc


@router.get("/plugins/rescan")
def rescan() -> dict:
    try:
        return svc.rescan_plugins()
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Rescan failed.") from exc


@router.post("/plugins/install")
def install(body: PluginInstallRequest) -> dict:
    return _ok_or_400(svc.install_plugin(body.identifier, force=body.force, enable=body.enable))


@router.post("/plugins/{name}/enable")
def enable(name: str) -> dict:
    try:
        svc.validate_plugin_name(name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid plugin name.")
    return _ok_or_400(svc.set_plugin_enabled(name, enabled=True))


@router.post("/plugins/{name}/disable")
def disable(name: str) -> dict:
    try:
        svc.validate_plugin_name(name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid plugin name.")
    return _ok_or_400(svc.set_plugin_enabled(name, enabled=False))


@router.post("/plugins/{name}/update")
def update(name: str) -> dict:
    try:
        svc.validate_plugin_name(name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid plugin name.")
    return _ok_or_400(svc.update_plugin(name))


@router.delete("/plugins/{name}")
def remove(name: str) -> dict:
    try:
        svc.validate_plugin_name(name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid plugin name.")
    return _ok_or_400(svc.remove_plugin(name))


@router.put("/plugins/providers")
def put_providers(body: PluginProvidersRequest) -> dict:
    return _ok_or_400(svc.save_plugin_providers(body.memory_provider, body.context_engine))


@router.put("/plugins/{name}/visibility")
def put_visibility(name: str, body: PluginVisibilityRequest) -> dict:
    try:
        svc.validate_plugin_name(name)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid plugin name.")
    return svc.set_plugin_visibility(name, body.hidden)
