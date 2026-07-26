"""Unit tests for ReviewService.create_pr same-branch pre-flight.

When the current branch equals the repo's default branch, ``gh pr create``
fails with a confusing raw error ("head branch X is the same as base branch X").
The service detects this up front and raises a clear ``PR_SAME_BRANCH:<branch>``
error instead, so the renderer can guide the user to switch to a feature branch.
"""
from __future__ import annotations

from pathlib import Path
import subprocess

import pytest

from daemon.services.git_service import GitServiceError
from daemon.services.review_service import ReviewService


def _init_repo(workspace: Path, branch: str = "main") -> None:
    workspace.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "init", "-b", branch], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "t@e.com"], cwd=workspace, check=True, capture_output=True)
    (workspace / "a.txt").write_text("x", encoding="utf-8")
    subprocess.run(["git", "add", "a.txt"], cwd=workspace, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=workspace, check=True, capture_output=True)


class _FakeSessionService:
    def __init__(self, workspace: Path) -> None:
        self._workspace = workspace

    def get_session(self, _session_id: str):
        return {"cwd": str(self._workspace)}


class TestCreatePrSameBranchPreFlight:
    def test_raises_clear_error_when_current_equals_default_branch(self, tmp_path: Path, monkeypatch):
        workspace = tmp_path / "repo"
        _init_repo(workspace, "main")
        svc = ReviewService(session_service=_FakeSessionService(workspace), hermes_home=tmp_path)
        # Force the default-branch resolution (would normally come from `gh`).
        svc._default_branch = lambda ws: "main"
        monkeypatch.setattr(
            "daemon.services.review_service.shutil.which",
            lambda cmd: "/usr/local/bin/gh" if cmd == "gh" else None,
        )

        with pytest.raises(GitServiceError) as exc_info:
            svc.create_pr("s")

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail == "PR_SAME_BRANCH:main"

    def test_skips_pre_flight_when_default_branch_unknown(self, tmp_path: Path, monkeypatch):
        # If gh can't determine the default branch (no remote / not authed),
        # the pre-flight is skipped and gh pr create runs, surfacing its own
        # error. We stub gh to a failing invocation to avoid needing a remote.
        workspace = tmp_path / "repo"
        _init_repo(workspace, "main")
        svc = ReviewService(session_service=_FakeSessionService(workspace), hermes_home=tmp_path)
        svc._default_branch = lambda ws: ""  # unknown → skip pre-flight

        captured: dict[str, object] = {}

        def fake_run(argv, **kwargs):
            captured["argv"] = argv
            captured["cwd"] = kwargs.get("cwd")

            class _R:
                returncode = 1
                stdout = ""
                stderr = "no git remotes found"

            return _R()

        monkeypatch.setattr("daemon.services.review_service.subprocess.run", fake_run)
        monkeypatch.setattr(
            "daemon.services.review_service.shutil.which",
            lambda cmd: "/usr/local/bin/gh" if cmd == "gh" else None,
        )

        with pytest.raises(GitServiceError) as exc_info:
            svc.create_pr("s")

        # Falls through to gh's own error, not the pre-flight code.
        assert exc_info.value.status_code == 500
        assert "PR_SAME_BRANCH" not in exc_info.value.detail
        assert "no git remotes found" in exc_info.value.detail
        # And gh pr create was actually attempted.
        assert captured["argv"][:3] == ["gh", "pr", "create"]

    def test_proceeds_when_on_a_feature_branch(self, tmp_path: Path, monkeypatch):
        workspace = tmp_path / "repo"
        _init_repo(workspace, "main")
        subprocess.run(["git", "checkout", "-b", "feature"], cwd=workspace, check=True, capture_output=True)
        svc = ReviewService(session_service=_FakeSessionService(workspace), hermes_home=tmp_path)
        svc._default_branch = lambda ws: "main"  # current 'feature' != default

        captured: dict[str, object] = {}

        def fake_run(argv, **kwargs):
            class _R:
                returncode = 0
                stdout = "https://github.com/me/repo/pull/9"
                stderr = ""

            return _R()

        monkeypatch.setattr("daemon.services.review_service.subprocess.run", fake_run)
        monkeypatch.setattr(
            "daemon.services.review_service.shutil.which",
            lambda cmd: "/usr/local/bin/gh" if cmd == "gh" else None,
        )

        result = svc.create_pr("s")

        assert result.ok is True
        assert result.url == "https://github.com/me/repo/pull/9"
