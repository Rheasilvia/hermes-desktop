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
