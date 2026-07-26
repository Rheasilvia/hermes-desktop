from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class ErrorEnvelope(BaseModel):
    code: str
    domain: Optional[str] = None
    path: Optional[str] = None
    detail: Optional[str] = None
    trace_id: str
