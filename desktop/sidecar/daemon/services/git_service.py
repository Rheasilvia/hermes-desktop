from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

from ..schemas.git import (
    DiffFile,
    DiffHunk,
    DiffLine,
    DiffSummary,
    GitBranchInfo,
    GitDiffResult,
)


class GitServiceError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class GitService:
    def __init__(self, *, session_service: Any, hermes_home: Path) -> None:
        self._session_service = session_service
        self._hermes_home = hermes_home

    def diff(self, session_id: str) -> GitDiffResult:
        workspace = self._workspace(session_id)
        result = _run_git(workspace, ["diff", "--no-ext-diff", "--no-color", "--unified=3"])
        if result.returncode != 0:
            stderr = (result.stderr or "").lower()
            if result.returncode == 128 or "not a git repository" in stderr:
                return _empty_diff(workspace)
            raise GitServiceError(500, f"git diff failed: {result.stderr.strip()}")
        return parse_git_diff(result.stdout, str(workspace))

    def branches(self, session_id: str) -> GitBranchInfo:
        workspace = self._workspace(session_id)
        current = _run_git(workspace, ["branch", "--show-current"])
        refs = _run_git(
            workspace,
            ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        )
        if refs.returncode != 0:
            stderr = refs.stderr.strip()
            if refs.returncode == 128 or "not a git repository" in stderr.lower():
                return GitBranchInfo(current="", branches=[])
            raise GitServiceError(500, f"git branch failed: {stderr}")
        current_name = current.stdout.strip()
        branches = [line.strip() for line in refs.stdout.splitlines() if line.strip()]
        if current_name and current_name not in branches:
            branches.append(current_name)
        return GitBranchInfo(current=current_name, branches=branches)

    def checkout(self, session_id: str, branch: str) -> dict[str, bool]:
        workspace = self._workspace(session_id)
        branches = set(self.branches(session_id).branches)
        if branch not in branches:
            raise GitServiceError(400, "BRANCH_NOT_FOUND")
        try:
            from .sandbox_runner import get_sandbox_runner

            runner = get_sandbox_runner()
        except Exception:
            runner = None
        if runner is None:
            raise GitServiceError(409, "SANDBOX_UNAVAILABLE")

        result = runner.run(
            command=["git", "-c", "core.hooksPath=/dev/null", "switch", "--", branch],
            cwd=str(workspace),
            env=_git_env(workspace),
            timeout=30,
            workspace_root=str(workspace),
            hermes_home=str(self._hermes_home),
        )
        if result.returncode != 0:
            raise GitServiceError(500, result.stderr.strip() or "GIT_CHECKOUT_FAILED")
        return {"ok": True}

    def _workspace(self, session_id: str) -> Path:
        session = self._session_service.get_session(session_id)
        if session is None:
            raise GitServiceError(404, "SESSION_NOT_FOUND")
        try:
            workspace = Path(str(session.get("cwd") or "")).expanduser().resolve(strict=True)
        except OSError as exc:
            raise GitServiceError(409, f"WORKSPACE_UNAVAILABLE: {exc}") from exc
        if not workspace.is_dir():
            raise GitServiceError(409, "WORKSPACE_UNAVAILABLE")
        return workspace


def _git_env(workspace: Path) -> dict[str, str]:
    return {
        "HOME": str(workspace),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_PAGER": "cat",
        "GIT_EXTERNAL_DIFF": "",
        "NO_COLOR": "1",
        "TERM": "dumb",
    }


def _run_git(workspace: Path, args: list[str], *, timeout: int = 10) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-c", "core.hooksPath=/dev/null", *args],
        cwd=str(workspace),
        env=_git_env(workspace),
        timeout=timeout,
        capture_output=True,
        text=True,
        check=False,
    )


def _empty_diff(workspace: Path) -> GitDiffResult:
    return GitDiffResult(
        files=[],
        summary=DiffSummary(files_changed=0, insertions=0, deletions=0),
        working_dir=str(workspace),
    )


def parse_git_diff(raw: str, working_dir: str) -> GitDiffResult:
    files: list[DiffFile] = []
    summary = DiffSummary(files_changed=0, insertions=0, deletions=0)
    current_file: DiffFile | None = None
    current_hunk: DiffHunk | None = None
    running_old = 0
    running_new = 0

    for line in raw.splitlines():
        if line.startswith("diff --git "):
            if current_file is not None:
                if current_hunk is not None:
                    current_file.hunks.append(current_hunk)
                    current_hunk = None
                summary.files_changed += 1
                files.append(current_file)
            parts = line[11:].split(" ")
            path = parts[1][2:] if len(parts) > 1 and parts[1].startswith("b/") else "unknown"
            current_file = DiffFile(path=path, old_path=None, status="modified", hunks=[])
        elif line.startswith("+++ ") or line.startswith("--- "):
            continue
        elif line.startswith("@@ ") and current_file is not None:
            if current_hunk is not None:
                current_file.hunks.append(current_hunk)
            current_hunk = parse_hunk_header(line)
            if current_hunk is not None:
                running_old = current_hunk.old_start
                running_new = current_hunk.new_start
        elif current_file is not None and current_hunk is not None:
            if line.startswith("+"):
                current_hunk.lines.append(
                    DiffLine(kind="addition", old_lineno=None, new_lineno=running_new, content=line[1:])
                )
                running_new += 1
                summary.insertions += 1
            elif line.startswith("-"):
                current_hunk.lines.append(
                    DiffLine(kind="deletion", old_lineno=running_old, new_lineno=None, content=line[1:])
                )
                running_old += 1
                summary.deletions += 1
            elif line.startswith(" ") or line == "":
                current_hunk.lines.append(
                    DiffLine(
                        kind="context",
                        old_lineno=running_old,
                        new_lineno=running_new,
                        content=line[1:] if line.startswith(" ") else "",
                    )
                )
                running_old += 1
                running_new += 1

    if current_file is not None:
        if current_hunk is not None:
            current_file.hunks.append(current_hunk)
        summary.files_changed += 1
        files.append(current_file)

    return GitDiffResult(files=files, summary=summary, working_dir=working_dir)


def parse_hunk_header(line: str) -> DiffHunk | None:
    rest = line.removeprefix("@@ ").lstrip()
    body = rest.split(" @@", maxsplit=1)[0]
    parts = body.split()
    if len(parts) < 2:
        return None
    old_start, old_count = _parse_range(parts[0])
    new_start, new_count = _parse_range(parts[1])
    return DiffHunk(
        header=line,
        old_start=old_start,
        old_count=old_count,
        new_start=new_start,
        new_count=new_count,
        lines=[],
    )


def _parse_range(value: str) -> tuple[int, int]:
    clean = value.removeprefix("-").removeprefix("+")
    start_text, _, count_text = clean.partition(",")
    return int(start_text or "1"), int(count_text or "1")
