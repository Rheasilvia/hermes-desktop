from __future__ import annotations

from pydantic import BaseModel


class ProjectEntry(BaseModel):
    path: str
    name: str
    last_opened_at: float | None = None


class ProjectListResult(BaseModel):
    projects: list[ProjectEntry]
    active_path: str | None = None


class ProjectUpsertRequest(BaseModel):
    path: str
    name: str | None = None


class ActiveProjectRequest(BaseModel):
    path: str | None


class WorktreeEntry(BaseModel):
    path: str
    branch: str | None = None
    bare: bool = False
    detached: bool = False


class WorktreeListResult(BaseModel):
    worktrees: list[WorktreeEntry]


class WorktreeAddRequest(BaseModel):
    repo_path: str
    path: str
    branch: str
    create_branch: bool = False


class WorktreeRemoveRequest(BaseModel):
    repo_path: str
    path: str


class BranchListResult(BaseModel):
    current: str
    branches: list[str]


class BranchSwitchRequest(BaseModel):
    path: str
    branch: str


class ProjectOkResult(BaseModel):
    ok: bool
