from __future__ import annotations

from pathlib import Path
from typing import Any

from ..db import connection as desktop_db
from ..schemas.projects import (
    BranchListResult,
    ProjectEntry,
    ProjectListResult,
    ProjectOkResult,
    WorktreeEntry,
    WorktreeListResult,
)
from .git_service import GitServiceError, _run_git_unsandboxed


class ProjectService:
    def __init__(self, *, hermes_home: Path) -> None:
        self._hermes_home = hermes_home

    def list_projects(self) -> ProjectListResult:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT path, name, last_opened_at FROM desktop_projects ORDER BY last_opened_at DESC, name"
            ).fetchall()
            active = conn.execute(
                "SELECT value FROM desktop_project_state WHERE key = 'active_path'"
            ).fetchone()
        return ProjectListResult(
            projects=[
                ProjectEntry(path=row["path"], name=row["name"], last_opened_at=row["last_opened_at"])
                for row in rows
            ],
            active_path=active["value"] if active is not None else None,
        )

    def upsert_project(self, path: str, name: str | None) -> ProjectEntry:
        project_path = self._existing_directory(path)
        display_name = (name or project_path.name or str(project_path)).strip()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO desktop_projects(path, name, last_opened_at)
                VALUES (?, ?, strftime('%s','now'))
                ON CONFLICT(path) DO UPDATE SET
                    name = excluded.name,
                    last_opened_at = excluded.last_opened_at
                """,
                (str(project_path), display_name),
            )
            conn.commit()
        return ProjectEntry(path=str(project_path), name=display_name)

    def set_active_project(self, path: str | None) -> ProjectListResult:
        active_path = None if path is None else str(self._existing_directory(path))
        with self._connect() as conn:
            if active_path is None:
                conn.execute("DELETE FROM desktop_project_state WHERE key = 'active_path'")
            else:
                conn.execute(
                    """
                    INSERT INTO desktop_project_state(key, value)
                    VALUES ('active_path', ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value
                    """,
                    (active_path,),
                )
                conn.execute(
                    """
                    INSERT INTO desktop_projects(path, name, last_opened_at)
                    VALUES (?, ?, strftime('%s','now'))
                    ON CONFLICT(path) DO UPDATE SET last_opened_at = excluded.last_opened_at
                    """,
                    (active_path, Path(active_path).name or active_path),
                )
            conn.commit()
        return self.list_projects()

    def list_worktrees(self, repo_path: str) -> WorktreeListResult:
        repo = self._existing_directory(repo_path)
        result = _run_git_unsandboxed(repo, ["worktree", "list", "--porcelain"])
        if result.returncode != 0:
            raise _git_error("git worktree list failed", result)
        return WorktreeListResult(worktrees=_parse_worktree_list(result.stdout))

    def add_worktree(self, repo_path: str, path: str, branch: str, create_branch: bool = False) -> ProjectOkResult:
        # User-initiated Projects-panel action; runs outside the agent sandbox.
        repo = self._existing_directory(repo_path)
        target = self._safe_target_path(path)
        args = ["worktree", "add"]
        if create_branch:
            args.extend(["-b", branch, str(target)])
        else:
            args.extend([str(target), branch])
        result = _run_git_unsandboxed(repo, args, timeout=60)
        if result.returncode != 0:
            raise _git_error("git worktree add failed", result)
        return ProjectOkResult(ok=True)

    def remove_worktree(self, repo_path: str, path: str) -> ProjectOkResult:
        repo = self._existing_directory(repo_path)
        target = self._safe_target_path(path)
        result = _run_git_unsandboxed(repo, ["worktree", "remove", str(target)], timeout=60)
        if result.returncode != 0:
            raise _git_error("git worktree remove failed", result)
        return ProjectOkResult(ok=True)

    def branches(self, repo_path: str) -> BranchListResult:
        repo = self._existing_directory(repo_path)
        current = _run_git_unsandboxed(repo, ["branch", "--show-current"])
        refs = _run_git_unsandboxed(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
        if refs.returncode != 0:
            raise _git_error("git branches failed", refs)
        return BranchListResult(
            current=current.stdout.strip() if current.returncode == 0 else "",
            branches=[line.strip() for line in refs.stdout.splitlines() if line.strip()],
        )

    def switch_branch(self, path: str, branch: str) -> ProjectOkResult:
        repo = self._existing_directory(path)
        for item in self.list_worktrees(str(repo)).worktrees:
            if item.path != str(repo) and item.branch == branch:
                raise GitServiceError(409, "BRANCH_ALREADY_CHECKED_OUT")
        result = _run_git_unsandboxed(repo, ["switch", "--", branch], timeout=30)
        if result.returncode != 0:
            raise _git_error("git switch failed", result)
        return ProjectOkResult(ok=True)

    def _connect(self):
        conn = desktop_db.connect(self._hermes_home)
        desktop_db.ensure_schema(conn)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS desktop_projects (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                last_opened_at REAL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS desktop_project_state (
                key TEXT PRIMARY KEY,
                value TEXT
            )
            """
        )
        conn.commit()
        return conn

    def _existing_directory(self, path: str) -> Path:
        try:
            resolved = Path(path).expanduser().resolve(strict=True)
        except OSError as exc:
            raise GitServiceError(409, f"PATH_UNAVAILABLE: {exc}") from exc
        if not resolved.is_dir():
            raise GitServiceError(409, "PATH_UNAVAILABLE")
        return resolved

    def _safe_target_path(self, path: str) -> Path:
        try:
            resolved = Path(path).expanduser().resolve(strict=False)
        except OSError as exc:
            raise GitServiceError(400, f"PATH_INVALID: {exc}") from exc
        if not resolved.parent.exists():
            raise GitServiceError(409, "PARENT_UNAVAILABLE")
        return resolved


def _parse_worktree_list(raw: str) -> list[WorktreeEntry]:
    out: list[WorktreeEntry] = []
    current: dict[str, Any] | None = None
    for line in raw.splitlines():
        if not line:
            if current is not None:
                out.append(_worktree_from_record(current))
                current = None
            continue
        key, _, value = line.partition(" ")
        if key == "worktree":
            if current is not None:
                out.append(_worktree_from_record(current))
            current = {"path": value}
        elif current is not None:
            current[key] = value or True
    if current is not None:
        out.append(_worktree_from_record(current))
    return out


def _worktree_from_record(record: dict[str, Any]) -> WorktreeEntry:
    branch = str(record.get("branch") or "")
    if branch.startswith("refs/heads/"):
        branch = branch.removeprefix("refs/heads/")
    return WorktreeEntry(
        path=str(record.get("path") or ""),
        branch=branch or None,
        bare=bool(record.get("bare", False)),
        detached=bool(record.get("detached", False)),
    )


def _git_error(prefix: str, result: Any) -> GitServiceError:
    stderr = (result.stderr or "").strip()
    if result.returncode == 128 or "not a git repository" in stderr.lower():
        return GitServiceError(409, "NOT_GIT_REPOSITORY")
    if result.returncode == -1 and "sandbox policy error" in stderr.lower():
        return GitServiceError(409, stderr)
    return GitServiceError(500, f"{prefix}: {stderr or 'unknown error'}")
