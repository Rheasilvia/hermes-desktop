from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


LineKind = Literal["context", "addition", "deletion"]
FileStatus = Literal["added", "modified", "deleted", "renamed"]


class DiffLine(BaseModel):
    kind: LineKind
    old_lineno: int | None
    new_lineno: int | None
    content: str


class DiffHunk(BaseModel):
    header: str
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: list[DiffLine]


class DiffFile(BaseModel):
    path: str
    old_path: str | None = None
    status: FileStatus = "modified"
    hunks: list[DiffHunk]


class DiffSummary(BaseModel):
    files_changed: int
    insertions: int
    deletions: int


class GitDiffResult(BaseModel):
    files: list[DiffFile]
    summary: DiffSummary
    working_dir: str


class GitBranchInfo(BaseModel):
    current: str
    branches: list[str]


class GitCheckoutRequest(BaseModel):
    branch: str
