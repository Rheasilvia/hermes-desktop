from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

from .git import GitDiffResult


ReviewFileStatus = Literal["added", "modified", "deleted", "renamed"]
CommitMessageStatus = Literal["generated", "unavailable", "failed"]


class ReviewFile(BaseModel):
    path: str
    old_path: str | None = None
    status: ReviewFileStatus
    staged: bool
    unstaged: bool
    untracked: bool
    insertions: int
    deletions: int


class ReviewSummary(BaseModel):
    files_changed: int
    insertions: int
    deletions: int
    staged_count: int
    unstaged_count: int
    untracked_count: int


class ReviewFilesResult(BaseModel):
    files: list[ReviewFile]
    summary: ReviewSummary
    working_dir: str
    branch: str


class ReviewDiffRequest(BaseModel):
    path: str | None = None
    staged: bool = False


class ReviewPathsRequest(BaseModel):
    paths: list[str]


class ReviewCommitRequest(BaseModel):
    message: str


class ReviewCommitMessageRequest(BaseModel):
    avoid: str | None = None


class ReviewCommitMessageResult(BaseModel):
    status: CommitMessageStatus
    message: str | None = None
    detail: str | None = None


class ReviewOkResult(BaseModel):
    ok: bool
    detail: str | None = None


class ReviewPrResult(BaseModel):
    ok: bool
    url: str | None = None
    detail: str | None = None


class ReviewDiffResult(GitDiffResult):
    pass
