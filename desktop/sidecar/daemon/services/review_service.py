from __future__ import annotations

from dataclasses import dataclass
import logging
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
    ReviewShipInfoResult,
    ReviewSummary,
)
from .git_service import GitService, GitServiceError, _run_git_unsandboxed, parse_git_diff

log = logging.getLogger(__name__)

_COMMIT_MESSAGE_DIFF_CHARS = 16_000
_COMMIT_MESSAGE_AVOID_CHARS = 2_000
_COMMIT_MESSAGE_MAX_TOKENS = 120
_RECENT_COMMIT_SUBJECTS = 8


@dataclass
class _StatusEntry:
    path: str
    old_path: str | None
    status: str
    staged: bool
    unstaged: bool
    untracked: bool


@dataclass
class _CommitMessageContext:
    diff_text: str
    recent_subjects: list[str]


class ReviewService:
    def __init__(
        self,
        *,
        session_service: Any,
        hermes_home: Path,
        agent_pool: Any | None = None,
    ) -> None:
        self._git = GitService(session_service=session_service, hermes_home=hermes_home)
        self._hermes_home = hermes_home
        self._agent_pool = agent_pool

    def files(self, session_id: str) -> ReviewFilesResult:
        workspace = self._workspace(session_id)
        status = self._run_git(
            workspace,
            ["status", "--porcelain=v1"],
        )
        if status.returncode != 0:
            if _is_not_git_repo(status):
                return _empty_files(workspace)
            raise _git_error("git status failed", status)

        branch = self._branch_name(workspace)
        staged_churn = self._numstat(workspace, staged=True)
        unstaged_churn = self._numstat(workspace, staged=False)
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
        rel_path = self._safe_relative_path(workspace, path) if path else None
        if rel_path and not staged and self._is_untracked(workspace, rel_path):
            return _untracked_file_diff(workspace, rel_path)

        args = ["diff"]
        if staged:
            args.append("--cached")
        args.extend(["--no-ext-diff", "--no-textconv", "--no-color", "--unified=3"])
        if rel_path:
            args.extend(["--", rel_path])
        result = self._run_git(workspace, args)
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
        workspace, rel_paths = self._mutation_context(session_id, "review stage", paths)
        result = self._run_git(workspace, ["add", "--", *rel_paths], timeout=30)
        if result.returncode != 0:
            raise _git_error("git add failed", result)
        return ReviewOkResult(ok=True)

    def unstage(self, session_id: str, paths: list[str]) -> ReviewOkResult:
        workspace, rel_paths = self._mutation_context(session_id, "review unstage", paths)
        result = self._run_git(workspace, ["restore", "--staged", "--", *rel_paths])
        if result.returncode != 0:
            raise _git_error("git restore --staged failed", result)
        return ReviewOkResult(ok=True)

    def revert(self, session_id: str, paths: list[str]) -> ReviewOkResult:
        workspace, rel_paths = self._mutation_context(session_id, "review revert", paths)
        tracked_paths: list[str] = []
        for rel_path in rel_paths:
            if self._is_untracked(workspace, rel_path):
                _remove_untracked(workspace, rel_path)
            else:
                tracked_paths.append(rel_path)
        if tracked_paths:
            result = self._run_git(
                workspace,
                ["restore", "--worktree", "--staged", "--", *tracked_paths],
                timeout=30,
            )
            if result.returncode != 0:
                raise _git_error("git restore failed", result)
        return ReviewOkResult(ok=True)

    def commit(self, session_id: str, message: str) -> ReviewOkResult:
        workspace = self._workspace(session_id)
        commit_message = message.strip()
        if not commit_message:
            raise GitServiceError(400, "COMMIT_MESSAGE_REQUIRED")
        has_staged = self._run_git(workspace, ["diff", "--cached", "--quiet"])
        if has_staged.returncode == 0:
            raise GitServiceError(409, "NO_STAGED_CHANGES")
        if has_staged.returncode not in (0, 1):
            raise _git_error("git diff --cached failed", has_staged)
        result = self._run_git(workspace, ["commit", "-m", commit_message], timeout=60)
        if result.returncode != 0:
            raise _git_error("git commit failed", result)
        return ReviewOkResult(ok=True)

    def push(self, session_id: str) -> ReviewOkResult:
        # User-initiated push: runs with the user's real git credentials and
        # network. The agent sandbox's network_access knob does not apply.
        workspace = self._workspace(session_id)
        result = self._run_git(workspace, ["push"], timeout=120)
        if result.returncode != 0:
            raise _git_error("git push failed", result)
        return ReviewOkResult(ok=True)

    def create_pr(self, session_id: str) -> ReviewPrResult:
        # User-initiated PR creation via gh. Runs with the user's real gh auth
        # and network; not gated by the agent sandbox's network_access knob.
        workspace = self._workspace(session_id)
        if shutil.which("gh") is None:
            raise GitServiceError(409, "PR_UNAVAILABLE")
        # Pre-flight: gh pr create fails with a confusing raw error if the
        # current branch equals the repo's default (base) branch. Detect that
        # case up front and return a clear, actionable error so the renderer
        # can tell the user to switch to a feature branch first.
        current_branch = self._current_branch(workspace)
        default_branch = self._default_branch(workspace)
        if (
            current_branch
            and default_branch
            and current_branch == default_branch
        ):
            raise GitServiceError(
                409,
                f"PR_SAME_BRANCH:{current_branch}",
            )
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

    def _current_branch(self, workspace: Path) -> str:
        """Current checked-out branch, or '' if it can't be determined."""
        try:
            result = self._run_git(workspace, ["branch", "--show-current"])
        except GitServiceError:
            return ""
        return result.stdout.strip() if result.returncode == 0 else ""

    def _default_branch(self, workspace: Path) -> str:
        """Repo default branch via gh, or '' if unavailable / not a gh repo.

        Best-effort: if gh isn't authenticated or the repo has no remote, we
        return '' so the same-branch pre-flight is simply skipped (and gh pr
        create runs, surfacing its own error as before).
        """
        if shutil.which("gh") is None:
            return ""
        env = dict(os.environ)
        env["GH_PROMPT_DISABLED"] = "1"
        env["NO_COLOR"] = "1"
        try:
            result = subprocess.run(
                ["gh", "repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"],
                cwd=str(workspace),
                env=env,
                text=True,
                capture_output=True,
                timeout=20,
                check=False,
            )  # noqa: S603
        except (subprocess.TimeoutExpired, OSError):
            return ""
        return result.stdout.strip() if result.returncode == 0 else ""

    def _current_pr_url(self, workspace: Path) -> str | None:
        """Current branch PR url via gh, or None when no PR/gh/auth exists."""
        env = dict(os.environ)
        env["GH_PROMPT_DISABLED"] = "1"
        env["NO_COLOR"] = "1"
        try:
            result = subprocess.run(
                ["gh", "pr", "view", "--json", "url", "-q", ".url"],
                cwd=str(workspace),
                env=env,
                text=True,
                capture_output=True,
                timeout=20,
                check=False,
            )  # noqa: S603
        except (subprocess.TimeoutExpired, OSError):
            return None
        if result.returncode != 0:
            return None
        url = result.stdout.strip()
        return url or None

    def default_branch(self, session_id: str) -> dict[str, str | None]:
        """Returns the repo's default branch (or null if unknown).

        Used by the renderer to disable the PR button when the current branch
        is the default. Best-effort: never raises — unknown just means null.
        """
        workspace = self._workspace(session_id)
        branch = self._default_branch(workspace)
        return {"branch": branch or None}

    def ship_info(self, session_id: str) -> ReviewShipInfoResult:
        """Best-effort PR and branch readiness for the Review toolbar."""
        workspace = self._workspace(session_id)
        gh_available = shutil.which("gh") is not None
        current_branch = self._current_branch(workspace)
        default_branch = self._default_branch(workspace) or None
        pr_url = self._current_pr_url(workspace) if gh_available else None
        can_create_pr = bool(
            gh_available
            and current_branch
            and not (default_branch and current_branch == default_branch)
        )
        return ReviewShipInfoResult(
            current_branch=current_branch,
            default_branch=default_branch,
            pr_url=pr_url,
            gh_available=gh_available,
            can_create_pr=can_create_pr,
        )

    def commit_message(self, session_id: str, avoid: str | None = None) -> ReviewCommitMessageResult:
        workspace = self._workspace(session_id)
        context = self._commit_message_context(session_id, workspace)
        if not context.diff_text.strip():
            return ReviewCommitMessageResult(status="failed", message=None, detail="NO_DIFF")
        message = self._commit_message_from_diff(
            session_id,
            context.diff_text,
            recent_subjects=context.recent_subjects,
            avoid=avoid,
        )
        if message is None:
            return ReviewCommitMessageResult(
                status="unavailable",
                message=None,
                detail="COMMIT_MESSAGE_PROVIDER_UNAVAILABLE",
            )
        return ReviewCommitMessageResult(status="generated", message=message)

    def _workspace(self, session_id: str) -> Path:
        return self._git._workspace(session_id)

    def _run_git(self, workspace: Path, args: list[str], *, timeout: int = 10):
        # Review-panel operations are user-initiated UI actions, not agent tool
        # calls, so they run outside the desktop sandbox with the user's real
        # environment. The desktop_sandbox mode/network knobs never apply here.
        return _run_git_unsandboxed(workspace, args, timeout=timeout)

    def _numstat(self, workspace: Path, *, staged: bool) -> dict[str, tuple[int, int]]:
        args = ["diff"]
        if staged:
            args.append("--cached")
        args.extend(["--numstat", "--no-ext-diff", "--no-textconv"])
        result = self._run_git(workspace, args)
        if result.returncode != 0:
            if _is_not_git_repo(result):
                return {}
            raise _git_error("git diff --numstat failed", result)
        return _parse_numstat(result.stdout)

    def _branch_name(self, workspace: Path) -> str:
        result = self._run_git(workspace, ["branch", "--show-current"])
        if result.returncode != 0:
            return ""
        return result.stdout.strip()

    def _mutation_context(
        self,
        session_id: str,
        context: str,
        paths: list[str],
    ) -> tuple[Path, list[str]]:
        # context is retained for logs/diagnostics only. No sandbox guard: the
        # agent sandbox's read-only mode does not apply to explicit user actions.
        del context
        workspace = self._workspace(session_id)
        rel_paths = [self._safe_relative_path(workspace, path) for path in paths]
        if not rel_paths:
            raise GitServiceError(400, "PATHS_REQUIRED")
        return workspace, rel_paths

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

    def _is_untracked(self, workspace: Path, rel_path: str) -> bool:
        result = self._run_git(
            workspace,
            ["status", "--porcelain=v1", "--", rel_path],
        )
        return any(line.startswith("?? ") for line in result.stdout.splitlines())

    def _commit_message_context(self, session_id: str, workspace: Path) -> _CommitMessageContext:
        staged_diff = self._raw_diff_for_commit_message(workspace, staged=True)
        if staged_diff.strip():
            return _CommitMessageContext(
                diff_text=_bounded_text(staged_diff, _COMMIT_MESSAGE_DIFF_CHARS),
                recent_subjects=self._recent_commit_subjects(workspace),
            )

        working_diff = self._raw_diff_for_commit_message(workspace, staged=False)
        untracked_diff = self._untracked_commit_message_context(session_id, workspace)
        diff_text = "\n\n".join(part for part in (working_diff, untracked_diff) if part.strip())
        return _CommitMessageContext(
            diff_text=_bounded_text(diff_text, _COMMIT_MESSAGE_DIFF_CHARS),
            recent_subjects=self._recent_commit_subjects(workspace),
        )

    def _raw_diff_for_commit_message(self, workspace: Path, *, staged: bool) -> str:
        args = ["diff"]
        if staged:
            args.append("--cached")
        args.extend(["--no-ext-diff", "--no-textconv", "--no-color", "--unified=3"])
        result = self._run_git(workspace, args)
        if result.returncode != 0:
            if _is_not_git_repo(result):
                return ""
            raise _git_error("git diff failed", result)
        return result.stdout

    def _untracked_commit_message_context(self, session_id: str, workspace: Path) -> str:
        files = [item for item in self.files(session_id).files if item.untracked]
        if not files:
            return ""
        chunks: list[str] = []
        for file in files:
            rel_path = self._safe_relative_path(workspace, file.path)
            chunks.append(_untracked_commit_message_chunk(workspace / rel_path, rel_path))
        return "\n".join(chunk for chunk in chunks if chunk)

    def _recent_commit_subjects(self, workspace: Path) -> list[str]:
        result = self._run_git(workspace, ["log", f"-n{_RECENT_COMMIT_SUBJECTS}", "--pretty=%s"])
        if result.returncode != 0:
            return []
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]

    def _commit_message_from_diff(
        self,
        session_id: str,
        diff_text: str,
        *,
        recent_subjects: list[str],
        avoid: str | None,
    ) -> str | None:
        messages = _commit_message_messages(
            diff_text=diff_text,
            recent_subjects=recent_subjects,
            avoid=avoid,
        )
        agent = self._agent_for_commit_message(session_id)
        if agent is not None:
            try:
                message = _call_commit_message_with_agent(agent, messages)
                cleaned = _clean_commit_message(message)
                if cleaned:
                    return cleaned
            except Exception:
                log.debug("agent commit-message generation failed", exc_info=True)

        try:
            from agent.auxiliary_client import call_llm

            response = call_llm(
                task="commit_message_generation",
                messages=messages,
                max_tokens=_COMMIT_MESSAGE_MAX_TOKENS,
                temperature=0.2,
                timeout=30.0,
            )
            content = response.choices[0].message.content or ""
            return _clean_commit_message(content)
        except Exception:
            log.warning("commit-message generation unavailable", exc_info=True)
            return None

    def _agent_for_commit_message(self, session_id: str) -> Any | None:
        if self._agent_pool is None:
            return None
        try:
            return self._agent_pool.get_agent_for_session(session_id)
        except Exception:
            log.debug("commit-message agent unavailable for %s", session_id, exc_info=True)
            return None


def _bounded_text(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    return value[:max_chars] + "\n\n[diff truncated]"


def _untracked_commit_message_chunk(path: Path, rel_path: str) -> str:
    if path.is_dir():
        return f"diff --git a/{rel_path} b/{rel_path}\nnew directory: {rel_path}"
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return f"diff --git a/{rel_path} b/{rel_path}\nnew file: {rel_path}"
    rows = text.splitlines()[:80]
    body = "\n".join(f"+{line}" for line in rows)
    suffix = "\n+[file truncated]" if len(text.splitlines()) > len(rows) else ""
    return (
        f"diff --git a/{rel_path} b/{rel_path}\n"
        "new file mode 100644\n"
        "--- /dev/null\n"
        f"+++ b/{rel_path}\n"
        f"@@ -0,0 +1,{len(rows)} @@\n"
        f"{body}{suffix}"
    )


def _commit_message_messages(
    *,
    diff_text: str,
    recent_subjects: list[str],
    avoid: str | None,
) -> list[dict[str, str]]:
    unique_recent = _unique_subjects(recent_subjects)
    recent = "\n".join(f"- {subject}" for subject in unique_recent[:_RECENT_COMMIT_SUBJECTS])
    avoid_text = _bounded_text(avoid or "", _COMMIT_MESSAGE_AVOID_CHARS)
    avoid_subject = _first_subject_line(avoid_text)
    user_parts = [
        "Write a concise git commit subject for this diff.",
        "Return exactly one line. No quotes, bullets, code fences, or explanation.",
    ]
    if recent:
        user_parts.append(f"Recent commit subjects to avoid repeating:\n{recent}")
    if avoid_text.strip() and _normalize_subject(avoid_subject) not in {
        _normalize_subject(subject) for subject in unique_recent
    }:
        user_parts.append(f"Also avoid duplicating this candidate:\n{avoid_text}")
    user_parts.append(f"Diff:\n{diff_text}")
    return [
        {
            "role": "system",
            "content": (
                "You write clear git commit subjects. Prefer Conventional Commit style "
                "when it naturally fits. Keep the subject under 72 characters."
            ),
        },
        {"role": "user", "content": "\n\n".join(user_parts)},
    ]


def _unique_subjects(subjects: list[str]) -> list[str]:
    seen: set[str] = set()
    unique: list[str] = []
    for subject in subjects:
        cleaned = _first_subject_line(subject)
        key = _normalize_subject(cleaned)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(cleaned)
    return unique


def _first_subject_line(value: str) -> str:
    return next((line.strip() for line in value.splitlines() if line.strip()), "")


def _normalize_subject(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).casefold()


def _call_commit_message_with_agent(agent: Any, messages: list[dict[str, str]]) -> str | None:
    model = getattr(agent, "model", "") or ""
    api_mode = getattr(agent, "api_mode", "chat_completions")

    if api_mode == "anthropic_messages":
        client = getattr(agent, "_anthropic_client", None)
        if client is None:
            return None
        system_msg = None
        user_msgs: list[dict[str, str]] = []
        for message in messages:
            if message["role"] == "system":
                system_msg = message["content"]
            else:
                user_msgs.append(message)
        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": _COMMIT_MESSAGE_MAX_TOKENS,
            "messages": user_msgs,
        }
        if system_msg:
            kwargs["system"] = system_msg
        response = client.messages.create(**kwargs)
        for block in getattr(response, "content", []) or []:
            if getattr(block, "type", None) == "text":
                return str(getattr(block, "text", ""))
        return None

    client = getattr(agent, "client", None)
    if client is None:
        return None
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        max_tokens=_COMMIT_MESSAGE_MAX_TOKENS,
        temperature=0.2,
    )
    return str(response.choices[0].message.content or "")


def _clean_commit_message(value: str | None) -> str | None:
    if not value:
        return None
    text = re.sub(r"<think>.*?</think>", "", value, flags=re.DOTALL | re.IGNORECASE).strip()
    text = text.replace("```", "").strip()
    if text.lower().startswith("commit message:"):
        text = text.split(":", maxsplit=1)[1].strip()
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    first_line = re.sub(r"^[-*]\s+", "", first_line).strip().strip("\"'")
    if first_line.lower().startswith("subject:"):
        first_line = first_line.split(":", maxsplit=1)[1].strip()
    if not first_line:
        return None
    return first_line[:120]


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
    # Untracked entries reported by git can be directories (collapsed to one
    # entry, e.g. `?? .codegraph/`). There is no line count for a directory;
    # skip reading it rather than relying on the OSError path below.
    if path.is_dir():
        return 0
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            count = sum(1 for _ in handle)
        return count
    except OSError:
        return 0


def _untracked_file_diff(workspace: Path, rel_path: str) -> GitDiffResult:
    path = workspace / rel_path
    # git status reports untracked *directories* (e.g. `?? .codegraph/`) collapsed
    # to a single entry. read_text() on a directory raises IsADirectoryError, so
    # guard before reading: there is no textual diff to show for a directory, and
    # the user still stages it normally (git add recurses). Surface it as an empty
    # added file with an explanatory banner rather than crashing the Review panel.
    try:
        if path.is_dir():
            return GitDiffResult(
                files=[
                    DiffFile(
                        path=rel_path,
                        old_path=None,
                        status="added",
                        hunks=[
                            DiffHunk(
                                header=f"@@ -0,0 +1,1 @@\n(untracked directory — stage with git add to include its contents)",
                                old_start=0,
                                old_count=0,
                                new_start=1,
                                new_count=1,
                                lines=[
                                    DiffLine(
                                        kind="addition",
                                        old_lineno=None,
                                        new_lineno=1,
                                        content="(untracked directory — no inline diff; stage it to include its files)",
                                    )
                                ],
                            )
                        ],
                    )
                ],
                summary=DiffSummary(files_changed=1, insertions=0, deletions=0),
                working_dir=str(workspace),
            )
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        # Only raise for genuine read failures (file gone, permission, ...), not
        # for the directory case handled above.
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


# macOS ships a git *shim* at /usr/bin/git that delegates to the real binary
# via xcrun. When the Command Line Tools are missing, moved (common after a
# macOS upgrade), or the active developer path is unset, the shim prints the
# xcrun error below and exits non-zero. This is an environment problem, not a
# repository problem, so we surface a dedicated, actionable error code instead
# of the raw "git status failed: xcrun: error: ..." string.
_XCRUN_FAILURE_MARKERS = (
    "invalid active developer path",
    "missing xcrun",
    "xcrun: error",
    "command line tools are not installed",
)


def _is_missing_developer_tools(result: Any) -> bool:
    stderr = (result.stderr or "").lower()
    return any(marker in stderr for marker in _XCRUN_FAILURE_MARKERS)


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
    if _is_missing_developer_tools(result):
        # Stable, machine-readable code so the renderer can show guidance
        # ("run xcode-select --install") instead of the raw xcrun stderr.
        return GitServiceError(503, "MACOS_DEVELOPER_TOOLS_MISSING")
    if result.returncode == -1 and "sandbox policy error" in stderr.lower():
        return GitServiceError(409, stderr)
    return GitServiceError(500, f"{prefix}: {stderr or 'unknown error'}")
