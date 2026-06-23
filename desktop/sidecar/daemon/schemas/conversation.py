from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class SessionMetaUpsert(BaseModel):
    pinned: bool = False
    archived: bool = False


class SessionMetaResponse(BaseModel):
    session_id: str
    pinned: bool
    archived: bool
    archived_at: Optional[float] = None
    last_opened_at: Optional[float]
    created_at: float


# ── Request / Response models for conversations router ─────────────────────


class CreateSessionRequest(BaseModel):
    model: Optional[str] = None
    system_prompt: Optional[str] = None
    cwd: Optional[str] = None
    provider: Optional[str] = None


class UpdateSessionRequest(BaseModel):
    title: Optional[str] = None
    cwd: Optional[str] = None
    archived: Optional[bool] = None


class SetSessionProviderRequest(BaseModel):
    provider: str
    model: Optional[str] = None


class SetPermissionModeRequest(BaseModel):
    mode: str


class UpdateSessionRuntimeRequest(BaseModel):
    reasoningEffort: Optional[str] = None
    collaborationMode: Optional[str] = None


class PromptExecuteRequest(BaseModel):
    message: str
    session_id: str
    provider: Optional[str] = None
    model: Optional[str] = None
    context: Optional[str] = None
    slash_command: Optional[dict] = None
    display_parts: Optional[list[dict]] = None


class ImageAttachRequest(BaseModel):
    session_id: str
    path: str


class ImageDetachRequest(BaseModel):
    session_id: str
    path: str


class ApprovalRespondRequest(BaseModel):
    session_id: str
    command: str = ""
    choice: str = "once"  # "once" | "session" | "always" | "deny"


class ClarifyRespondRequest(BaseModel):
    session_id: str
    request_id: str
    answer: str


class SudoRespondRequest(BaseModel):
    request_id: str
    password: str = ""


class SecretRespondRequest(BaseModel):
    request_id: str
    value: str = ""


# ── Response models ────────────────────────────────────────────────────────


class SessionResponse(BaseModel):
    id: str
    source: str = "desktop"
    model: str = ""
    title: str = "New Session"
    started_at: Optional[float] = None
    ended_at: Optional[float] = None
    message_count: int = 0
    cwd: Optional[str] = None
    archived: bool = False
    archivedAt: Optional[float] = None
    permissionMode: str = "auto"


class CreateSessionResponse(BaseModel):
    session_id: str
    id: str
    source: str = "desktop"
    model: str = ""
    provider: str = ""
    title: str = "New Session"
    started_at: Optional[float] = None
    cwd: Optional[str] = None
    archived: bool = False
    archivedAt: Optional[float] = None
    model_configured: bool = False
    permissionMode: str = "auto"


class PromptExecuteResponse(BaseModel):
    status: str = "accepted"
    session_id: str


class OkResponse(BaseModel):
    ok: bool = True
