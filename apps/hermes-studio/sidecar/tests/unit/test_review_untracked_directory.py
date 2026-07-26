"""Unit tests for review_service handling of untracked *directories*.

git status collapses an untracked directory into a single entry (e.g.
``?? .codegraph/``). The review panel used to crash with
``FILE_NOT_FOUND: [Errno 21] Is a directory`` when the user opened such an
entry's diff, because it read the directory as a text file. These tests pin the
fixed behavior: directories get an explanatory empty diff and a 0 line count.
"""
from __future__ import annotations

from pathlib import Path

import pytest


class TestUntrackedDirectoryDiff:
    def test_untracked_directory_returns_explanatory_empty_diff(self, tmp_path: Path):
        from daemon.services.review_service import _untracked_file_diff

        workspace = tmp_path / "ws"
        workspace.mkdir()
        untracked_dir = workspace / ".codegraph"
        untracked_dir.mkdir()
        (untracked_dir / "node.bin").write_text("x", encoding="utf-8")

        result = _untracked_file_diff(workspace, ".codegraph")

        assert result.files[0].path == ".codegraph"
        assert result.files[0].status == "added"
        # No phantom insertions — a directory has no textual line count.
        assert result.summary.files_changed == 1
        assert result.summary.insertions == 0
        assert result.summary.deletions == 0
        banner = result.files[0].hunks[0].lines[0].content
        assert "directory" in banner.lower()

    def test_untracked_file_still_shows_full_add_diff(self, tmp_path: Path):
        from daemon.services.review_service import _untracked_file_diff

        workspace = tmp_path / "ws"
        workspace.mkdir()
        (workspace / "new.txt").write_text("alpha\nbeta\n", encoding="utf-8")

        result = _untracked_file_diff(workspace, "new.txt")

        lines = result.files[0].hunks[0].lines
        contents = [line.content for line in lines]
        assert contents == ["alpha", "beta"]
        assert result.summary.files_changed == 1
        assert result.summary.insertions == 2
        assert result.summary.deletions == 0

    def test_missing_untracked_path_still_raises_not_found(self, tmp_path: Path):
        from daemon.services.git_service import GitServiceError
        from daemon.services.review_service import _untracked_file_diff

        workspace = tmp_path / "ws"
        workspace.mkdir()

        with pytest.raises(GitServiceError) as exc_info:
            _untracked_file_diff(workspace, "ghost.txt")

        assert exc_info.value.status_code == 404
        assert "FILE_NOT_FOUND" in exc_info.value.detail


class TestCountTextLines:
    def test_directory_returns_zero_instead_of_reading(self, tmp_path: Path):
        from daemon.services.review_service import _count_text_lines

        d = tmp_path / "somedir"
        d.mkdir()

        assert _count_text_lines(d) == 0

    def test_text_file_counts_lines(self, tmp_path: Path):
        from daemon.services.review_service import _count_text_lines

        f = tmp_path / "f.txt"
        f.write_text("one\ntwo\nthree\n", encoding="utf-8")

        assert _count_text_lines(f) == 3
