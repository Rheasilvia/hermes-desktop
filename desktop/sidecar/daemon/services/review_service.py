from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
import re
import shutil
import subprocess
from typing import Any

from ..schemas.git import DiffFile, DiffHunk, DiffLine, DiffSummary, GitDiffResult
from ..schemas.review import (
    ReviewCommitMessageResult,
    ReviewFilesResult,
    ReviewFile,
    ReviewOkResult,
    ReviewPrResult,
    ReviewSummary,
)
from .git_service import GitService, GitServiceError, _run_git, parse_git_diff


@dataclass
class _StatusEntry:
    path: str
    old_path: str | None
    status: str
    staged: bool
    unstaged: bool
    untracked: bool


class ReviewService:
    def __init__(self, *, session_service: Any, hermes_home: Path) -> None:
        self._git = GitService(session_service=session_service, hermes_home=hermes_home)
        self._hermes_home = hermes_home

    def files(self, session_id: str) -> ReviewFilesResult:
        workspace = self._workspace(session_id)
        sandbox_policy = self._sandbox_policy("review files")
        status = self._run_git(
            workspace,
            ["status", "--porcelain=v1"],
            sandbox_policy=sandbox_policy,
        )
        if status.returncode != 0:
            if _is_not_git_repo(status):
                return _empty_files(workspace)
            raise _git_error("git status failed", status)

        branch = self._branch_name(workspace, sandbox_policy)
        staged_churn = self._numstat(workspace, sandbox_policy, staged=True)
        unstaged_churn = self._numstat(workspace, sandbox_policy, staged=False)
        entries = _parse_status(status.stdout)
        files: list[ReviewFile] = []
        for entry in entries:
            if _is_internal_review_path(entry.path):
                continue
            staged = staged_churn.get(entry.path, (0, 0))
            unstaged = unstaged_churn.get(entry.path, (0, 0))
            insertions = staged[0] + unstaged[0]
            deletions = staged[1] + unstaged[1]
            if entry.untracked and insertions == 0 and deletions == 0:
                insertions = _count_text_lines(workspace / entry.path)
            files.append(
                ReviewFile(
                    path=entry.path,
                    old_path=entry.old_path,
                    status=entry.status,  # type: ignore[arg-type]
                    staged=entry.staged,
                    unstaged=entry.unstaged,
                    untracked=entry.untracked,
                    insertions=insertions,
                    deletions=deletions,
                )
            )
        files.sort(key=lambda item: item.path)
        summary = ReviewSummary(
            files_changed=len(files),
            insertions=sum(item.insertions for item in files),
            deletions=sum(item.deletions for item in files),
            staged_count=sum(1 for item in files if item.staged),
            unstaged_count=sum(1 for item in files if item.unstaged),
            untracked_count=sum(1 for item in files if item.untracked),
        )
        return ReviewFilesResult(files=files, summary=summary, working_dir=str(workspace), branch=branch)

    def diff(self, session_id: str, *, path: str | None = None, staged: bool = False) -> GitDiffResult:
        workspace = self._workspace(session_id)
        sandbox_policy = self._sandbox_policy("review diff")
        rel_path = self._safe_relative_path(workspace, path) if path else None
        if rel_path and not staged and self._is_untracked(workspace, rel_path, sandbox_policy):
            return _untracked_file_diff(workspace, rel_path)

        args = ["diff"]
        if staged:
            args.append("--cached")
        args.extend(["--no-ext-diff", "--no-textconv", "--no-color", "--unified=3"])
        if rel_path:
            args.extend(["--", rel_path])
        result = self._run_git(workspace, args, sandbox_policy=sandbox_policy)
        if result.returncode != 0:
            if _is_not_git_repo(result):
                return _empty_diff(workspace)
            raise _git_error("git diff failed", result)
        parsed = parse_git_diff(result.stdout, str(workspace))
        if rel_path and parsed.files:
            status_by_path = {item.path: item.status for item in self.files(session_id).files}
            for file in parsed.files:
                if file.path in status_by_path:
                    file.status = status_by_path[file.path]  # type: ignore[assignment]
        return parsed

    def stage(self, session_id: str, paths: list[str]) -> ReviewOkResult:
        workspace, sandbox_policy, rel_paths = self._mutation_context(session_id, "review stage", paths)
        result = self._run_git(workspace, ["add", "--", *rel_paths], sandbox_policy=sandbox_policy, timeout=30)
        if result.returncode != 0:
            raise _git_error("git add failed", result)
        return ReviewOkResult(ok=True)

    def unstage(self, session_id: str, paths: list[str]) -> ReviewOkResult:
        workspace, sandbox_policy, rel_paths = self._mutation_context(session_id, "review unstage", paths)
        result = self._run_git(workspace, ["restore", "--staged", "--", *rel_paths], sandbox_policy=sandbox_policy)
        if result.returncode != 0:
            raise _git_error("git restore --staged failed", result)
        return ReviewOkResult(ok=True)

    def revert(self, session_id: str, paths: list[str]) -> ReviewOkResult:
        workspace, sandbox_policy, rel_paths = self._mutation_context(session_id, "review revert", paths)
        tracked_paths: list[str] = []
        for rel_path in rel_paths:
            if self._is_untracked(workspace, rel_path, sandbox_policy):
                _remove_untracked(workspace, rel_path)
            else:
                tracked_paths.append(rel_path)
        if tracked_paths:
            result = self._run_git(
                workspace,
                ["restore", "--worktree", "--staged", "--", *tracked_paths],
                sandbox_policy=sandbox_policy,
                timeout=30,
            )
            if result.returncode != 0:
                raise _git_error("git restore failed", result)
        return ReviewOkResult(ok=True)

    def commit(self, session_id: str, message: str) -> ReviewOkResult:
        workspace = self._workspace(session_id)
        sandbox_policy = self._sandbox_policy("review commit")
        self._ensure_workspace_write(sandbox_policy)
        commit_message = message.strip()
        if not commit_message:
            raise GitServiceError(400, "COMMIT_MESSAGE_REQUIRED")
        has_staged = self._run_git(workspace, ["diff", "--cached", "--quiet"], sandbox_policy=sandbox_policy)
        if has_staged.returncode == 0:
            raise GitServiceError(409, "NO_STAGED_CHANGES")
        if has_staged.returncode not in (0, 1):
            raise _git_error("git diff --cached failed", has_staged)
        result = self._run_git(workspace, ["commit", "-m", commit_message], sandbox_policy=sandbox_policy, timeout=60)
        if result.returncode != 0:
            raise _git_error("git commit failed", result)
        return ReviewOkResult(ok=True)

    def push(self, session_id: str) -> ReviewOkResult:
        workspace = self._workspace(session_id)
        sandbox_policy = self._sandbox_policy("review push")
        self._ensure_workspace_write(sandbox_policy)
        self._ensure_network(sandbox_policy)
        result = self._run_git(workspace, ["push"], sandbox_policy=sandbox_policy, timeout=120)
        if result.returncode != 0:
            raise _git_error("git push failed", result)
        return ReviewOkResult(ok=True)

    def create_pr(self, session_id: str) -> ReviewPrResult:
        workspace = self._workspace(session_id)
        sandbox_policy = self._sandbox_policy("review pr")
        self._ensure_network(sandbox_policy)
        if shutil.which("gh") is None:
            raise GitServiceError(409, "PR_UNAVAILABLE")
        env = os.environ.copy()
        env["GH_PROMPT_DISABLED"] = "1"
        env["NO_COLOR"] = "1"
        try:
            result = subprocess.run(
                # Fixed argv; no shell interpolation.
                ["gh", "pr", "create", "--fill"],
                cwd=str(workspace),
                env=env,
                text=True,
                capture_output=True,
                timeout=120,
                check=False,
            )  # noqa: S603
        except subprocess.TimeoutExpired as exc:
            raise GitServiceError(504, "PR_CREATE_TIMEOUT") from exc
        except OSError as exc:
            raise GitServiceError(409, f"PR_UNAVAILABLE: {exc}") from exc
        if result.returncode != 0:
            stderr = (result.stderr or result.stdout or "").strip()
            raise GitServiceError(500, f"gh pr create failed: {stderr or 'unknown error'}")
        output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
        match = re.search(r"https://\S+/pull/\d+", output)
        return ReviewPrResult(ok=True, url=match.group(0) if match else None, detail=output or None)

    def commit_message(self, session_id: str, avoid: str | None = None) -> ReviewCommitMessageResult:
        workspace = self._workspace(session_id)
        sandbox_policy = self._sandbox_policy("review commit message")
        staged = self.diff(session_id, staged=True)
        diff_result = staged if staged.files else self.diff(session_id)
        if not diff_result.files:
            return ReviewCommitMessageResult(status="failed", message=None, detail="NO_DIFF")
        message = self._commit_message_from_diff(workspace, sandbox_policy, diff_result, avoid=avoid)
        if message is None:
            return ReviewCommitMessageResult(
                status="unavailable",
                message=None,
                detail="COMMIT_MESSAGE_PROVIDER_UNAVAILABLE",
            )
        return ReviewCommitMessageResult(status="generated", message=message)

    def _workspace(self, session_id: str) -> Path:
        return self._git._workspace(session_id)

    def _sandbox_policy(self, context: str) -> dict[str, str]:
        return self._git._sandbox_policy(context)

    def _run_git(self, workspace: Path, args: list[str], *, sandbox_policy: dict[str, str], timeout: int = 10):
        return _run_git(
            workspace,
            args,
            hermes_home=self._hermes_home,
            sandbox_policy=sandbox_policy,
            timeout=timeout,
        )

    def _numstat(self, workspace: Path, sandbox_policy: dict[str, str], *, staged: bool) -> dict[str, tuple[int, int]]:
        args = ["diff"]
        if staged:
            args.append("--cached")
        args.extend(["--numstat", "--no-ext-diff", "--no-textconv"])
        result = self._run_git(workspace, args, sandbox_policy=sandbox_policy)
        if result.returncode != 0:
            if _is_not_git_repo(result):
                return {}
            raise _git_error("git diff --numstat failed", result)
        return _parse_numstat(result.stdout)

    def _branch_name(self, workspace: Path, sandbox_policy: dict[str, str]) -> str:
        result = self._run_git(workspace, ["branch", "--show-current"], sandbox_policy=sandbox_policy)
        if result.returncode != 0:
            return ""
        return result.stdout.strip()

    def _mutation_context(
        self,
        session_id: str,
        context: str,
        paths: list[str],
    ) -> tuple[Path, dict[str, str], list[str]]:
        workspace = self._workspace(session_id)
        sandbox_policy = self._sandbox_policy(context)
        self._ensure_workspace_write(sandbox_policy)
        rel_paths = [self._safe_relative_path(workspace, path) for path in paths]
        if not rel_paths:
            raise GitServiceError(400, "PATHS_REQUIRED")
        return workspace, sandbox_policy, rel_paths

    def _ensure_workspace_write(self, sandbox_policy: dict[str, str]) -> None:
        if sandbox_policy.get("mode") == "read-only":
            raise GitServiceError(403, "SANDBOX_READ_ONLY")

    def _ensure_network(self, sandbox_policy: dict[str, str]) -> None:
        if sandbox_policy.get("network_access") != "enabled":
            raise GitServiceError(403, "NETWORK_RESTRICTED")

    def _safe_relative_path(self, workspace: Path, path: str | None) -> str:
        if path is None or not path.strip():
            raise GitServiceError(400, "PATH_REQUIRED")
        candidate = Path(path)
        if candidate.is_absolute():
            try:
                resolved = candidate.expanduser().resolve(strict=False)
            except OSError as exc:
                raise GitServiceError(400, f"PATH_INVALID: {exc}") from exc
            if not _is_within(workspace, resolved):
                raise GitServiceError(403, "PATH_OUTSIDE_WORKSPACE")
            return resolved.relative_to(workspace).as_posix()
        normalized = Path(path)
        if any(part == ".." for part in normalized.parts):
            try:
                resolved = (workspace / normalized).resolve(strict=False)
            except OSError as exc:
                raise GitServiceError(400, f"PATH_INVALID: {exc}") from exc
            if not _is_within(workspace, resolved):
                raise GitServiceError(403, "PATH_OUTSIDE_WORKSPACE")
            return resolved.relative_to(workspace).as_posix()
        return normalized.as_posix()

    def _is_untracked(self, workspace: Path, rel_path: str, sandbox_policy: dict[str, str]) -> bool:
        result = self._run_git(
            workspace,
            ["status", "--porcelain=v1", "--", rel_path],
            sandbox_policy=sandbox_policy,
        )
        return any(line.startswith("?? ") for line in result.stdout.splitlines())

    def _commit_message_from_diff(
        self,
        _workspace: Path,
        _sandbox_policy: dict[str, str],
        _diff: GitDiffResult,
        *,
        avoid: str | None,
    ) -> str | None:
        if avoid:
            _ = avoid[:2000]
        return None


def _parse_status(raw: str) -> list[_StatusEntry]:
    entries: list[_StatusEntry] = []
    for line in raw.splitlines():
        if not line:
            continue
        if line.startswith("?? "):
            entries.append(
                _StatusEntry(
                    path=line[3:],
                    old_path=None,
                    status="added",
                    staged=False,
                    unstaged=False,
                    untracked=True,
                )
            )
            continue
        if len(line) < 4:
            continue
        index_status = line[0]
        worktree_status = line[1]
        path_text = line[3:]
        old_path = None
        if " -> " in path_text:
            old_path, path_text = path_text.split(" -> ", maxsplit=1)
        staged = index_status != " "
        unstaged = worktree_status != " "
        status_code = index_status if staged else worktree_status
        entries.append(
            _StatusEntry(
                path=path_text,
                old_path=old_path,
                status=_status_from_code(status_code),
                staged=staged,
                unstaged=unstaged,
                untracked=False,
            )
        )
    return entries


def _is_internal_review_path(path: str) -> bool:
    return path == ".hermes-sandbox" or path.startswith(".hermes-sandbox/")


def _status_from_code(code: str) -> str:
    if code == "A":
        return "added"
    if code == "D":
        return "deleted"
    if code == "R":
        return "renamed"
    return "modified"


def _parse_numstat(raw: str) -> dict[str, tuple[int, int]]:
    out: dict[str, tuple[int, int]] = {}
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        inserted = _safe_int(parts[0])
        deleted = _safe_int(parts[1])
        path = parts[-1]
        out[path] = (inserted, deleted)
    return out


def _safe_int(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0


def _count_text_lines(path: Path) -> int:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            count = sum(1 for _ in handle)
        return count
    except OSError:
        return 0


def _untracked_file_diff(workspace: Path, rel_path: str) -> GitDiffResult:
    path = workspace / rel_path
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise GitServiceError(404, f"FILE_NOT_FOUND: {exc}") from exc
    rows = content.splitlines()
    hunk = DiffHunk(
        header=f"@@ -0,0 +1,{len(rows)} @@",
        old_start=0,
        old_count=0,
        new_start=1,
        new_count=len(rows),
        lines=[
            DiffLine(kind="addition", old_lineno=None, new_lineno=index + 1, content=line)
            for index, line in enumerate(rows)
        ],
    )
    return GitDiffResult(
        files=[DiffFile(path=rel_path, old_path=None, status="added", hunks=[hunk])],
        summary=DiffSummary(files_changed=1, insertions=len(rows), deletions=0),
        working_dir=str(workspace),
    )


def _remove_untracked(workspace: Path, rel_path: str) -> None:
    target = (workspace / rel_path).resolve(strict=False)
    if not _is_within(workspace, target):
        raise GitServiceError(403, "PATH_OUTSIDE_WORKSPACE")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        try:
            target.unlink()
        except FileNotFoundError:
            return


def _is_within(root: Path, path: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _is_not_git_repo(result: Any) -> bool:
    stderr = (result.stderr or "").lower()
    return result.returncode == 128 or "not a git repository" in stderr


def _empty_files(workspace: Path) -> ReviewFilesResult:
    return ReviewFilesResult(
        files=[],
        summary=ReviewSummary(
            files_changed=0,
            insertions=0,
            deletions=0,
            staged_count=0,
            unstaged_count=0,
            untracked_count=0,
        ),
        working_dir=str(workspace),
        branch="",
    )


def _empty_diff(workspace: Path) -> GitDiffResult:
    return GitDiffResult(
        files=[],
        summary=DiffSummary(files_changed=0, insertions=0, deletions=0),
        working_dir=str(workspace),
    )


def _git_error(prefix: str, result: Any) -> GitServiceError:
    stderr = (result.stderr or "").strip()
    if _is_not_git_repo(result):
        return GitServiceError(409, "NOT_GIT_REPOSITORY")
    if result.returncode == -1 and "sandbox policy error" in stderr.lower():
        return GitServiceError(409, stderr)
    return GitServiceError(500, f"{prefix}: {stderr or 'unknown error'}")
