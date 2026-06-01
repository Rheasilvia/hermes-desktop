from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel


class SlashCompleteRequest(BaseModel):
    partial: str = ""


class CommandRequest(BaseModel):
    session_id: Optional[str] = None
    command: str
    args: Optional[str] = None
    raw: Optional[str] = None


class CommandCatalogItem(BaseModel):
    command: str
    description: str
    category: Optional[str] = None
    aliases: list[str] = []
    args_hint: str = ""
    source: str = "registry"
    supported: bool = True
    icon: Optional[str] = None


class SlashCompleteItem(BaseModel):
    command: str
    description: str
    category: Optional[str] = None
    icon: Optional[str] = None


class SlashCompleteResponse(BaseModel):
    items: list[SlashCompleteItem]


class CommandResult(BaseModel):
    kind: Literal["output", "send", "skill", "unsupported", "error"]
    message: str
    name: Optional[str] = None

