from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from ..schemas.workspace import (
    WorkspaceChildrenResult,
    WorkspaceFileResult,
    WorkspaceTreeNode,
)
from .workspace_policy import (
    WorkspacePolicySnapshot,
    build_workspace_policy_snapshot,
    resolve_path,
)

WORKSPACE_CHILD_LIMIT = 1000
WORKSPACE_FILE_MAX_BYTES = 100 * 1024
SKIPPED_WORKSPACE_DIRS = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".cache",
        ".next",
        ".nuxt",
        ".pytest_cache",
        ".ruff_cache",
        ".mypy_cache",
        "__pycache__",
        "node_modules",
        "dist",
        "build",
        "target",
        "venv",
        ".venv",
    }
)


class WorkspaceServiceError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class WorkspaceService:
    def __init__(self, *, session_service: Any) -> None:
        self._session_service = session_service

    def list_children(self, session_id: str, path: str) -> WorkspaceChildrenResult:
        snapshot = self._snapshot(session_id)
        target = self._resolve(snapshot, path, access="read")
        if not target.is_dir():
            raise WorkspaceServiceError(400, "workspace path is not a directory")

        children: list[WorkspaceTreeNode] = []
        total_read = 0
        truncated = False

        try:
            entries = list(target.iterdir())
        except OSError as exc:
            raise WorkspaceServiceError(403, f"permission denied or unreadable directory: {exc}") from exc

        for entry in entries:
            total_read += 1
            try:
                if entry.is_symlink():
                    continue
                if not entry.is_dir() and not entry.is_file():
                    continue
            except OSError:
                continue

            name = entry.name
            is_dir = entry.is_dir()
            if is_dir and name in SKIPPED_WORKSPACE_DIRS:
                continue

            if len(children) >= WORKSPACE_CHILD_LIMIT:
                truncated = True
                continue

            kind = "directory" if is_dir else "file"
            children.append(
                WorkspaceTreeNode(
                    path=str(entry),
                    name=name,
                    kind=kind,
                    ignored=False,
                    loaded=kind == "file",
                )
            )

        children.sort(key=_workspace_sort_key)
        return WorkspaceChildrenResult(
            root=str(snapshot.workspace_root),
            path=str(target),
            children=children,
            truncated=truncated,
            total_read=total_read,
        )

    def read_file(self, session_id: str, path: str) -> WorkspaceFileResult:
        snapshot = self._snapshot(session_id)
        target = self._resolve(snapshot, path, access="read")
        if not target.is_file():
            raise WorkspaceServiceError(400, "workspace path is not a file")

        try:
            size = target.stat().st_size
            with target.open("rb") as handle:
                payload = handle.read(WORKSPACE_FILE_MAX_BYTES)
        except OSError as exc:
            raise WorkspaceServiceError(403, f"cannot read file: {exc}") from exc

        truncated = size > WORKSPACE_FILE_MAX_BYTES
        try:
            return WorkspaceFileResult(
                content=payload.decode("utf-8"),
                truncated=truncated,
                binary=False,
                size=size,
            )
        except UnicodeDecodeError:
            return WorkspaceFileResult(content=None, truncated=False, binary=True, size=size)

    def reveal(self, session_id: str, path: str) -> dict[str, bool]:
        snapshot = self._snapshot(session_id)
        target = self._resolve(snapshot, path, access="read")
        argv = _reveal_argv(target)
        try:
            subprocess.Popen(  # noqa: S603 - argv is fixed per platform, target is policy-resolved.
                argv,
                cwd=str(snapshot.workspace_root),
                env=_minimal_env(snapshot.workspace_root),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except FileNotFoundError as exc:
            raise WorkspaceServiceError(409, "REVEAL_UNAVAILABLE") from exc
        except OSError as exc:
            raise WorkspaceServiceError(500, f"reveal failed: {exc}") from exc
        return {"ok": True}

    def _snapshot(self, session_id: str) -> WorkspacePolicySnapshot:
        session = self._session_service.get_session(session_id)
        if session is None:
            raise WorkspaceServiceError(404, "SESSION_NOT_FOUND")
        try:
            return build_workspace_policy_snapshot(
                session_id=session_id,
                turn_id="desktop-api",
                cwd=session.get("cwd") or "",
                permission_mode=session.get("permissionMode") or "auto",
            )
        except ValueError as exc:
            raise WorkspaceServiceError(409, f"WORKSPACE_UNAVAILABLE: {exc}") from exc

    def _resolve(self, snapshot: WorkspacePolicySnapshot, path: str, *, access: str) -> Path:
        decision = resolve_path(snapshot, path, access)
        if not decision.allowed or decision.resolved_path is None:
            raise WorkspaceServiceError(403, decision.reason)
        return decision.resolved_path


def _workspace_sort_key(node: WorkspaceTreeNode) -> tuple[int, int, str]:
    kind_rank = 0 if node.kind == "directory" else 1
    dot_rank = 0 if node.name.startswith(".") else 1
    return (kind_rank, dot_rank, node.name.lower())


def _minimal_env(workspace_root: Path) -> dict[str, str]:
    return {
        "HOME": str(workspace_root),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
        "NO_COLOR": "1",
        "TERM": "dumb",
    }


def _reveal_argv(path: Path) -> list[str]:
    if sys.platform == "darwin":
        return ["open", "-R", str(path)]
    if os.name == "nt":
        return ["explorer", "/select,", str(path)]
    target = path if path.is_dir() else path.parent
    return ["xdg-open", str(target)]
