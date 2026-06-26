from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


WorkspaceTreeNodeKind = Literal["file", "directory"]


class WorkspaceTreeNode(BaseModel):
    path: str
    name: str
    kind: WorkspaceTreeNodeKind
    ignored: bool = False
    loaded: bool = False


class WorkspaceChildrenResult(BaseModel):
    root: str
    path: str
    children: list[WorkspaceTreeNode]
    truncated: bool
    total_read: int


class WorkspaceFileResult(BaseModel):
    content: str | None
    truncated: bool
    binary: bool
    size: int
    mtime: float


class RevealWorkspacePathRequest(BaseModel):
    path: str


class WriteWorkspaceFileRequest(BaseModel):
    path: str
    content: str
    expected_mtime: float | None = None
    expected_size: int | None = None
