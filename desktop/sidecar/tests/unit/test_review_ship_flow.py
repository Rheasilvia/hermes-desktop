from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
import subprocess

from daemon.services.review_service import ReviewService, _commit_message_messages


def _run_git(workspace: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=workspace, check=True, capture_output=True, text=True)


def _init_repo(workspace: Path, branch: str = "main") -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    _run_git(workspace, "init", "-b", branch)
    _run_git(workspace, "config", "user.name", "Test User")
    _run_git(workspace, "config", "user.email", "test@example.com")
    (workspace / "tracked.txt").write_text("old\n", encoding="utf-8")
    _run_git(workspace, "add", "tracked.txt")
    _run_git(workspace, "commit", "-m", "init")


class _FakeSessionService:
    def __init__(self, workspace: Path) -> None:
        self._workspace = workspace

    def get_session(self, _session_id: str) -> dict[str, str]:
        return {"cwd": str(self._workspace)}


class _FakeCompletions:
    def __init__(self, content: str) -> None:
        self.content = content
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> SimpleNamespace:
        self.calls.append(kwargs)
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=self.content),
                ),
            ],
        )


class _FakeAgent:
    def __init__(self, content: str) -> None:
        self.model = "gpt-test"
        self.api_mode = "chat_completions"
        self.completions = _FakeCompletions(content)
        self.client = SimpleNamespace(
            chat=SimpleNamespace(completions=self.completions),
        )


class _FakeAgentPool:
    def __init__(self, agent: _FakeAgent | None) -> None:
        self.agent = agent

    def get_agent_for_session(self, _session_id: str) -> _FakeAgent | None:
        return self.agent


def test_commit_message_generates_from_session_agent(tmp_path: Path) -> None:
    workspace = tmp_path / "repo"
    _init_repo(workspace)
    (workspace / "tracked.txt").write_text("old\nnew\n", encoding="utf-8")
    agent = _FakeAgent("Commit message: feat: update tracked file\n\nBody ignored")
    svc = ReviewService(
        session_service=_FakeSessionService(workspace),
        hermes_home=tmp_path,
        agent_pool=_FakeAgentPool(agent),
    )

    result = svc.commit_message("s", avoid="fix: stale candidate")

    assert result.status == "generated"
    assert result.message == "feat: update tracked file"
    call = agent.completions.calls[0]
    assert call["model"] == "gpt-test"
    prompt = call["messages"][1]["content"]
    assert "fix: stale candidate" in prompt
    assert "tracked.txt" in prompt


def test_commit_message_uses_untracked_diff_context(tmp_path: Path) -> None:
    workspace = tmp_path / "repo"
    _init_repo(workspace)
    (workspace / "new.txt").write_text("alpha\nbeta\n", encoding="utf-8")
    agent = _FakeAgent("feat: add new text file")
    svc = ReviewService(
        session_service=_FakeSessionService(workspace),
        hermes_home=tmp_path,
        agent_pool=_FakeAgentPool(agent),
    )

    result = svc.commit_message("s")

    assert result.status == "generated"
    assert result.message == "feat: add new text file"
    prompt = agent.completions.calls[0]["messages"][1]["content"]
    assert "new file mode 100644" in prompt
    assert "+++ b/new.txt" in prompt


def test_commit_message_reports_provider_unavailable(tmp_path: Path) -> None:
    workspace = tmp_path / "repo"
    _init_repo(workspace)
    (workspace / "tracked.txt").write_text("old\nnew\n", encoding="utf-8")
    svc = ReviewService(
        session_service=_FakeSessionService(workspace),
        hermes_home=tmp_path,
        agent_pool=_FakeAgentPool(None),
    )
    svc._commit_message_from_diff = lambda *args, **kwargs: None  # type: ignore[method-assign]

    result = svc.commit_message("s")

    assert result.status == "unavailable"
    assert result.message is None
    assert result.detail == "COMMIT_MESSAGE_PROVIDER_UNAVAILABLE"


def test_commit_message_prompt_deduplicates_recent_subjects_and_avoid() -> None:
    messages = _commit_message_messages(
        diff_text="diff --git a/a.txt b/a.txt",
        recent_subjects=["feat: update docs", "Feat:   update docs", "fix: tests"],
        avoid="feat: update docs",
    )

    prompt = messages[1]["content"]
    assert prompt.count("- feat: update docs") == 1
    assert prompt.count("- fix: tests") == 1
    assert "Also avoid duplicating this candidate" not in prompt


def test_ship_info_reports_gh_unavailable(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "repo"
    _init_repo(workspace, branch="feature/review")
    monkeypatch.setattr("daemon.services.review_service.shutil.which", lambda _cmd: None)
    svc = ReviewService(session_service=_FakeSessionService(workspace), hermes_home=tmp_path)

    info = svc.ship_info("s")

    assert info.current_branch == "feature/review"
    assert info.default_branch is None
    assert info.pr_url is None
    assert info.gh_available is False
    assert info.can_create_pr is False


def test_ship_info_reports_existing_pr(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "repo"
    _init_repo(workspace)
    _run_git(workspace, "checkout", "-b", "feature/review")

    monkeypatch.setattr(
        "daemon.services.review_service.shutil.which",
        lambda cmd: "/usr/local/bin/gh" if cmd == "gh" else None,
    )
    svc = ReviewService(session_service=_FakeSessionService(workspace), hermes_home=tmp_path)
    svc._default_branch = lambda _workspace: "main"  # type: ignore[method-assign]
    svc._current_pr_url = lambda _workspace: "https://github.com/me/repo/pull/7"  # type: ignore[method-assign]

    info = svc.ship_info("s")

    assert info.current_branch == "feature/review"
    assert info.default_branch == "main"
    assert info.pr_url == "https://github.com/me/repo/pull/7"
    assert info.gh_available is True
    assert info.can_create_pr is True


def test_ship_info_blocks_default_branch_pr(tmp_path: Path, monkeypatch) -> None:
    workspace = tmp_path / "repo"
    _init_repo(workspace, branch="main")

    monkeypatch.setattr(
        "daemon.services.review_service.shutil.which",
        lambda cmd: "/usr/local/bin/gh" if cmd == "gh" else None,
    )
    svc = ReviewService(session_service=_FakeSessionService(workspace), hermes_home=tmp_path)
    svc._default_branch = lambda _workspace: "main"  # type: ignore[method-assign]
    svc._current_pr_url = lambda _workspace: None  # type: ignore[method-assign]

    info = svc.ship_info("s")

    assert info.current_branch == "main"
    assert info.default_branch == "main"
    assert info.pr_url is None
    assert info.gh_available is True
    assert info.can_create_pr is False
