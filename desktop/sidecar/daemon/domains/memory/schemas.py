"""Pydantic models for the memory router.

Field names mirror the dataclasses in ``services.memory_files`` and the
TypeScript types in ``desktop/src/types/memory.ts``. The cross-language
parity test (``tests/unit/test_memory_schema_parity.py``) enforces that
every field here exists in the matching TS interface and vice versa.

``well_known_name`` is typed as ``Literal[...]`` so non-whitelist values
fail at parse time (HTTP 422) and never reach the service layer.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from daemon.services.memory_files import ALL_NAMES, PROJECT_FILES, USER_FILES

Scope = Literal["user", "project"]
WellKnownName = Literal[
    "AGENTS.md",
    "CLAUDE.md",
    ".hermes/context.md",
    ".hermes/memories/MEMORY.md",
    "memories/MEMORY.md",
    "memories/USER.md",
]

# Defensive: keep the Literal in sync with the service-side tuples. If the
# tuples ever drift, importers fail loud at module load.
assert set(ALL_NAMES) == {
    "AGENTS.md",
    "CLAUDE.md",
    ".hermes/context.md",
    ".hermes/memories/MEMORY.md",
    "memories/MEMORY.md",
    "memories/USER.md",
}, "WellKnownName Literal drifted from service-side ALL_NAMES"
assert set(USER_FILES) | set(PROJECT_FILES) == set(ALL_NAMES)


class MemoryFileInfo(BaseModel):
    scope: Scope
    workspace_path: Optional[str] = None
    well_known_name: WellKnownName
    abs_path: str
    exists: bool
    size_bytes: int
    modified_at: Optional[str] = None


class MemoryFileWithContent(MemoryFileInfo):
    content: str


class MemorySearchHit(BaseModel):
    info: MemoryFileInfo
    line_number: int = Field(..., ge=1)
    snippet: str
    match_count: int = Field(..., ge=1)


class MemoryProject(BaseModel):
    workspace_path: str
    last_used_at: str  # ISO 8601 UTC
    session_count: int = Field(..., ge=0)


# ── Request bodies ──────────────────────────────────────────────────────


class WriteFileRequest(BaseModel):
    scope: Scope
    workspace: Optional[str] = None
    name: WellKnownName
    content: str


class SearchRequest(BaseModel):
    query: str
    scope: Optional[Scope] = None
    workspace: Optional[str] = None


# ── Response wrappers ───────────────────────────────────────────────────


class MemoryFileListResponse(BaseModel):
    files: List[MemoryFileInfo]


class MemoryProjectListResponse(BaseModel):
    projects: List[MemoryProject]


class MemorySearchResponse(BaseModel):
    hits: List[MemorySearchHit]


class MemoryConcurrentWriteEnvelope(BaseModel):
    """Body returned with HTTP 409 so the UI can show a merge dialog.

    Carries the latest server-side info+content so the client can show what
    changed without an extra round-trip.
    """

    code: Literal["MEMORY_CONCURRENT_WRITE"] = "MEMORY_CONCURRENT_WRITE"
    detail: Optional[str] = None
    current: MemoryFileWithContent
