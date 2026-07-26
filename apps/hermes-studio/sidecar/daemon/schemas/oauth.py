"""Pydantic schemas for OAuth provider endpoints."""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class OAuthProviderStatus(BaseModel):
    """Connection status for one OAuth provider."""

    id: str
    name: str
    flow: str  # pkce | device_code | external
    logged_in: bool = False
    source: Optional[str] = None
    source_label: Optional[str] = None
    token_preview: Optional[str] = None
    expires_at: Optional[str] = None
    has_refresh_token: bool = False
    cli_command: Optional[str] = None
    docs_url: Optional[str] = None


class OAuthStartResponse(BaseModel):
    session_id: str
    flow: str  # pkce | device_code
    # PKCE fields
    auth_url: Optional[str] = None
    expires_in: Optional[int] = None
    # device-code fields
    user_code: Optional[str] = None
    verification_url: Optional[str] = None
    poll_interval: Optional[int] = None


class OAuthSubmitRequest(BaseModel):
    session_id: str
    code: str


class OAuthPollResponse(BaseModel):
    session_id: str
    status: str  # pending | approved | denied | expired | error
    error_message: Optional[str] = None
