from __future__ import annotations

import os
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
        # User-initiated Git-panel action: runs outside the agent sandbox with
        # the user's real environment (desktop_sandbox.mode/network never apply).
        result = _run_git_unsandboxed(
            workspace,
            ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--unified=3"],
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").lower()
            if result.returncode == 128 or "not a git repository" in stderr:
                return _empty_diff(workspace)
            raise GitServiceError(500, f"git diff failed: {result.stderr.strip()}")
        return parse_git_diff(result.stdout, str(workspace))

    def branches(self, session_id: str) -> GitBranchInfo:
        workspace = self._workspace(session_id)
        current = _run_git_unsandboxed(workspace, ["branch", "--show-current"])
        refs = _run_git_unsandboxed(
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
        # User-initiated Git-panel action; not gated by the agent sandbox's
        # read-only mode (that knob constrains agent tool calls, not explicit
        # user checkouts).
        branches = set(self.branches(session_id).branches)
        if branch not in branches:
            raise GitServiceError(400, "BRANCH_NOT_FOUND")
        result = _run_git_unsandboxed(workspace, ["switch", "--", branch], timeout=30)
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
    """Sandboxed environment for agent-driven git calls.

    Points HOME/git-config at an isolated per-workspace scratch dir so an
    agent-initiated git command cannot read the user's real identity/credentials.
    Used by the (agent) ``_run_git`` path only.
    """
    from .sandbox_runner import with_workspace_scratch_env

    return with_workspace_scratch_env({
        "HOME": str(workspace),
        "PATH": os.environ.get("PATH", "/usr/bin:/bin:/usr/sbin:/sbin"),
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_PAGER": "cat",
        "GIT_EXTERNAL_DIFF": "",
        "NO_COLOR": "1",
        "TERM": "dumb",
    }, workspace)


def _user_git_env() -> dict[str, str]:
    """Environment for user-initiated git/gh calls (Review/Git/Projects panels).

    These are explicit, deliberate user actions — not agent tool calls — so they
    must NOT be sandboxed and must run with the *user's real* environment: their
    HOME (git identity, ``~/.gitconfig``, credential helper), their PATH (where
    ``gh`` and any credential helpers live), and their authenticated git/gh
    state. Isolating them would break push auth and ``gh pr create``.
    """
    env = dict(os.environ)
    # Keep pager/diff behavior stable and non-interactive for parsing.
    env.setdefault("GIT_TERMINAL_PROMPT", "0")
    env["GIT_PAGER"] = "cat"
    env["GIT_EXTERNAL_DIFF"] = ""
    env["NO_COLOR"] = "1"
    env["TERM"] = "dumb"
    return env


def _run_git(
    workspace: Path,
    args: list[str],
    *,
    hermes_home: Path,
    sandbox_policy: dict[str, str],
    timeout: int = 10,
):
    try:
        from .sandbox_runner import get_sandbox_runner

        runner = get_sandbox_runner()
    except Exception:
        runner = None
    if runner is None:
        raise GitServiceError(409, "SANDBOX_UNAVAILABLE")
    try:
        env = _git_env(workspace)
    except Exception as exc:
        raise GitServiceError(409, f"SANDBOX_UNAVAILABLE: {exc}") from exc
    return runner.run(
        command=["git", "-c", "core.hooksPath=/dev/null", *args],
        cwd=str(workspace),
        env=env,
        timeout=timeout,
        workspace_root=str(workspace),
        hermes_home=str(hermes_home),
        sandbox_mode=sandbox_policy["mode"],
        network_access=sandbox_policy["network_access"],
    )


def _run_git_unsandboxed(
    workspace: Path,
    args: list[str],
    *,
    timeout: int = 30,
):
    """Run git for a user-initiated panel action, outside the agent sandbox.

    Review/Git/Projects panel operations are explicit user actions, not agent
    tool calls, so they bypass the desktop sandbox entirely and run with the
    user's real environment (identity, credentials, PATH). The agent-sandbox
    ``mode``/``network_access`` knobs never apply here.

    Returns a ``SandboxResult``-shaped object (``.returncode/.stdout/.stderr``)
    so call sites can share the existing ``_git_error`` classifier unchanged.
    """
    import subprocess

    argv = ["git", "-c", "core.hooksPath=/dev/null", *args]
    try:
        completed = subprocess.run(
            argv,
            cwd=str(workspace),
            env=_user_git_env(),
            timeout=timeout,
            capture_output=True,
            text=True,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise GitServiceError(504, f"git command timed out: {' '.join(args)}") from exc
    except OSError as exc:
        # e.g. git binary missing / not executable.
        raise GitServiceError(409, f"git unavailable: {exc}") from exc
    return _CompletedAsResult(completed)


class _CompletedAsResult:
    """Adapter so unsandboxed ``subprocess.CompletedProcess`` shares the
    ``.returncode/.stdout/.stderr`` surface that ``_git_error`` expects from the
    sandbox runner's ``SandboxResult``."""

    __slots__ = ("returncode", "stdout", "stderr")

    def __init__(self, completed: "subprocess.CompletedProcess[str]") -> None:
        self.returncode = int(completed.returncode)
        self.stdout = str(completed.stdout or "")
        self.stderr = str(completed.stderr or "")


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
