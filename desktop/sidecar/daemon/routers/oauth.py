"""OAuth provider endpoints — list, start, submit, poll, disconnect, cancel."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from ..schemas.oauth import (
    OAuthPollResponse,
    OAuthProviderStatus,
    OAuthStartResponse,
    OAuthSubmitRequest,
)

log = logging.getLogger(__name__)

router = APIRouter()


def _get_service():
    from ..services.oauth_service import (
        list_providers,
        get_provider_entry,
        cancel_session,
        disconnect_provider,
        poll_device_code_session,
        start_pkce,
        submit_pkce,
        start_device_code_flow,
    )
    # Return module-level functions directly (stateless service pattern)
    return {
        "list": list_providers,
        "get": get_provider_entry,
        "cancel": cancel_session,
        "disconnect": disconnect_provider,
        "poll": poll_device_code_session,
        "pkce_start": start_pkce,
        "pkce_submit": submit_pkce,
        "device_start": start_device_code_flow,
    }


@router.get("/providers/oauth")
def list_oauth_providers() -> list[dict]:
    """List all OAuth providers with current connection status."""
    svc = _get_service()
    return svc["list"]()


@router.post("/providers/oauth/{provider_id}/start")
async def start_oauth(provider_id: str) -> dict:
    """Start an OAuth login flow (PKCE or device-code)."""
    svc = _get_service()
    entry = svc["get"](provider_id)
    if not entry:
        raise HTTPException(status_code=404, detail="PROVIDER_NOT_FOUND")

    flow = entry.get("flow", "")
    try:
        if flow == "pkce":
            return svc["pkce_start"](provider_id)
        if flow == "device_code":
            return await svc["device_start"](provider_id)
        if flow == "external":
            raise HTTPException(
                status_code=400,
                detail=f"{entry['name']} requires CLI setup. Run: {entry.get('cli_command', 'N/A')}",
            )
        raise HTTPException(
            status_code=400, detail=f"Unknown flow type: {flow}"
        )
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    except Exception as e:
        log.exception("oauth/start failed for %s", provider_id)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/providers/oauth/{provider_id}/submit")
def submit_oauth_code(provider_id: str, body: OAuthSubmitRequest) -> dict:
    """Submit an authorization code for PKCE token exchange."""
    if provider_id != "anthropic":
        raise HTTPException(
            status_code=400,
            detail=f"Code submission not supported for {provider_id}",
        )
    svc = _get_service()
    try:
        return svc["pkce_submit"](body.session_id, body.code)
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        log.exception("oauth/submit failed for %s", provider_id)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/providers/oauth/{provider_id}/poll/{session_id}")
def poll_oauth_session(provider_id: str, session_id: str) -> dict:
    """Poll a device-code session for status updates."""
    svc = _get_service()
    try:
        return svc["poll"](session_id)
    except RuntimeError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        log.exception("oauth/poll failed for %s/%s", provider_id, session_id)
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete("/providers/oauth/{provider_id}")
def disconnect_oauth_provider(provider_id: str) -> dict:
    """Disconnect / clear OAuth credentials for a provider."""
    svc = _get_service()
    try:
        svc["disconnect"](provider_id)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"ok": True}


@router.delete("/providers/oauth/sessions/{session_id}")
def cancel_oauth_session(session_id: str) -> dict:
    """Cancel a pending OAuth session."""
    svc = _get_service()
    try:
        svc["cancel"](session_id)
    except Exception as e:
        log.exception("oauth/cancel failed for session %s", session_id)
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"ok": True}
