"""Unit tests for review_service git-failure classification helpers.

These cover the ``_git_error`` classifier — specifically the macOS
Command Line Tools / xcrun shim failure that would otherwise surface as a
confusing raw ``git status failed: xcrun: error: ...`` message.
"""
from __future__ import annotations

from dataclasses import dataclass

import pytest


@dataclass
class _FakeResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""


# ---------------------------------------------------------------------------
# _is_missing_developer_tools
# ---------------------------------------------------------------------------

class TestIsMissingDeveloperTools:
    @pytest.mark.parametrize(
        "stderr",
        [
            # The exact message the user hit.
            "xcrun: error: invalid active developer path "
            "(/Library/Developer/CommandLineTools), missing xcrun at: "
            "/Library/Developer/CommandLineTools/usr/bin/xcrun",
            # Case-insensitive variant of the same.
            "XCRUN: ERROR: invalid active developer path",
            # Alternate phrasings the shim emits in other toolchain states.
            "xcrun: error: command line tools are not installed",
            "missing xcrun at: /some/path",
        ],
    )
    def test_detects_developer_tools_failure(self, stderr: str):
        from daemon.services.review_service import _is_missing_developer_tools

        assert _is_missing_developer_tools(_FakeResult(returncode=1, stderr=stderr)) is True

    def test_ignores_unrelated_git_failures(self):
        from daemon.services.review_service import _is_missing_developer_tools

        assert _is_missing_developer_tools(
            _FakeResult(returncode=1, stderr="fatal: not a git repository")
        ) is False

    def test_treats_empty_stderr_as_not_missing(self):
        from daemon.services.review_service import _is_missing_developer_tools

        assert _is_missing_developer_tools(_FakeResult(returncode=1)) is False


# ---------------------------------------------------------------------------
# _git_error — end-to-end classification
# ---------------------------------------------------------------------------

class TestGitErrorClassification:
    def test_xcrun_failure_maps_to_actionable_service_error(self):
        from daemon.services.git_service import GitServiceError
        from daemon.services.review_service import _git_error

        result = _FakeResult(
            returncode=1,
            stderr="xcrun: error: invalid active developer path "
            "(/Library/Developer/CommandLineTools), missing xcrun at: "
            "/Library/Developer/CommandLineTools/usr/bin/xcrun",
        )

        error = _git_error("git status failed", result)

        # Stable, machine-readable code so the renderer can show guidance
        # instead of the raw xcrun stderr.
        assert isinstance(error, GitServiceError)
        assert error.detail == "MACOS_DEVELOPER_TOOLS_MISSING"
        assert error.status_code == 503

    def test_not_a_git_repository_takes_priority_over_xcrun_check(self):
        from daemon.services.review_service import _git_error

        # A genuine repo-missing failure must not be mislabelled as a
        # developer-tools problem even if stderr were to contain xcrun noise.
        result = _FakeResult(
            returncode=128,
            stderr="fatal: not a git repository (or any of the parent directories): .git",
        )

        error = _git_error("git status failed", result)

        assert error.detail == "NOT_GIT_REPOSITORY"

    def test_generic_failure_keeps_raw_detail(self):
        from daemon.services.review_service import _git_error

        result = _FakeResult(returncode=1, stderr="some other git failure")

        error = _git_error("git status failed", result)

        assert error.status_code == 500
        assert error.detail == "git status failed: some other git failure"
