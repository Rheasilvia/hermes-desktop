from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class SessionMetaUpsert(BaseModel):
    workspace_path: Optional[str] = None
    pinned: bool = False
    archived: bool = False


class SessionMetaResponse(BaseModel):
    session_id: str
    workspace_path: Optional[str]
    pinned: bool
    archived: bool
    last_opened_at: Optional[float]
    created_at: float


# ── Request / Response models for conversations router ─────────────────────


class CreateSessionRequest(BaseModel):
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    workspace_path: Optional[str] = None
    provider: Optional[str] = None


class RenameSessionRequest(BaseModel):
    title: str


class SetSessionProviderRequest(BaseModel):
    provider: str
    model: Optional[str] = None


class PromptExecuteRequest(BaseModel):
    message: str
    session_id: str
    provider: Optional[str] = None
    model: Optional[str] = None


class ApprovalRespondRequest(BaseModel):
    session_id: str
    command: str = ""
    choice: str = "once"  # "once" | "session" | "always" | "deny"


class ClarifyRespondRequest(BaseModel):
    session_id: str
    request_id: str
    answer: str


# ── Response models ────────────────────────────────────────────────────────


class SessionResponse(BaseModel):
    id: str
    source: str = "desktop"
    model: str = ""
    title: str = "New Session"
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    message_count: int = 0
    workspace_path: Optional[str] = None


class CreateSessionResponse(BaseModel):
    session_id: str
    id: str
    source: str = "desktop"
    model: str = ""
    provider: str = ""
    title: str = "New Session"
    started_at: Optional[float] = None
    workspace_path: Optional[str] = None
    model_configured: bool = False


class PromptExecuteResponse(BaseModel):
    status: str = "accepted"
    session_id: str


class OkResponse(BaseModel):
    ok: bool = True
