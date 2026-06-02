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


# Lifecycle session actions performed by the frontend (no card, no navigation).
ActionName = Literal["new", "branch", "resume", "title"]

# Inline-card kinds rendered in the command-card dock above the chat input.
CardType = Literal[
    "sessions", "tools", "skills", "cron", "plugins", "memory", "platforms",
    "logs", "agents", "usage", "status", "model", "config", "help",
    "account", "output", "notice",
]


class CommandResult(BaseModel):
    kind: Literal["output", "send", "skill", "unsupported", "error", "action", "card"]
    message: str = ""  # text payload for card_type in {logs, account, output, notice}
    name: Optional[str] = None
    action: Optional[ActionName] = None
    card_type: Optional[CardType] = None

