"""Unit tests for workspace_policy — snapshot building and path resolution."""

from __future__ import annotations

import os

import pytest

from daemon.services.workspace_policy import (
    build_workspace_policy_snapshot,
    get_workspace_policy_snapshot,
    reset_workspace_policy_snapshot,
    resolve_path,
    set_workspace_policy_snapshot,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _snapshot(tmp_path, permission_mode="auto"):
    return build_workspace_policy_snapshot(
        session_id="sess-1",
        turn_id="turn-1",
        cwd=str(tmp_path),
        permission_mode=permission_mode,
    )


# ---------------------------------------------------------------------------
# build_workspace_policy_snapshot
# ---------------------------------------------------------------------------


class TestBuildWorkspacePolicySnapshot:
    def test_valid_directory_succeeds(self, tmp_path):
        snap = _snapshot(tmp_path)
        assert snap.cwd == tmp_path.resolve()
        assert snap.workspace_root == snap.cwd
        assert snap.policy_version == "desktop-workspace-v2"
        assert snap.sandbox_mode == "workspace-write"
        assert snap.network_access == "restricted"
        assert snap.protected_metadata_names == (".codex", ".agents", ".hermes")
        assert len(snap.workspace_hash) == 16

    def test_workspace_hash_is_hex(self, tmp_path):
        snap = _snapshot(tmp_path)
        int(snap.workspace_hash, 16)  # raises if not valid hex

    def test_nonexistent_path_raises(self, tmp_path):
        with pytest.raises((ValueError, OSError)):
            build_workspace_policy_snapshot(
                "s", "t", str(tmp_path / "does_not_exist"), "auto"
            )

    def test_file_path_raises(self, tmp_path):
        f = tmp_path / "file.txt"
        f.write_text("x")
        with pytest.raises(ValueError):
            build_workspace_policy_snapshot("s", "t", str(f), "auto")

    def test_invalid_sandbox_mode_raises(self, tmp_path):
        with pytest.raises(ValueError, match="sandbox_mode"):
            build_workspace_policy_snapshot(
                "s", "t", str(tmp_path), "auto", sandbox_mode="off"  # type: ignore[arg-type]
            )

    def test_invalid_network_access_raises(self, tmp_path):
        with pytest.raises(ValueError, match="network_access"):
            build_workspace_policy_snapshot(
                "s", "t", str(tmp_path), "auto", network_access="open"  # type: ignore[arg-type]
            )


# ---------------------------------------------------------------------------
# ContextVar helpers
# ---------------------------------------------------------------------------


class TestContextVar:
    def test_get_returns_none_when_unset(self):
        """fail-closed callers can detect no snapshot is present."""
        # Run in a fresh context to avoid test-order contamination
        import contextvars

        ctx = contextvars.copy_context()

        def _check():
            return get_workspace_policy_snapshot()

        result = ctx.run(_check)
        assert result is None

    def test_set_and_get_round_trip(self, tmp_path):
        snap = _snapshot(tmp_path)
        token = set_workspace_policy_snapshot(snap)
        try:
            assert get_workspace_policy_snapshot() is snap
        finally:
            reset_workspace_policy_snapshot(token)

    def test_reset_restores_none(self, tmp_path):
        snap = _snapshot(tmp_path)
        token = set_workspace_policy_snapshot(snap)
        reset_workspace_policy_snapshot(token)
        assert get_workspace_policy_snapshot() is None


# ---------------------------------------------------------------------------
# resolve_path — allowed cases
# ---------------------------------------------------------------------------


class TestResolvePathAllowed:
    def test_relative_path_under_cwd(self, tmp_path):
        (tmp_path / "src").mkdir()
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, "src/app.py", "read")
        assert decision.allowed
        assert decision.resolved_path is not None
        assert decision.resolved_path.is_absolute()
        assert decision.resolved_path == tmp_path / "src" / "app.py"

    def test_absolute_path_under_workspace(self, tmp_path):
        sub = tmp_path / "data"
        sub.mkdir()
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, str(sub / "report.csv"), "read")
        assert decision.allowed
        assert decision.resolved_path == sub / "report.csv"

    def test_new_file_under_existing_workspace_parent(self, tmp_path):
        (tmp_path / "output").mkdir()
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, "output/new_file.txt", "write")
        assert decision.allowed
        assert decision.resolved_path == tmp_path / "output" / "new_file.txt"

    def test_direct_child_of_workspace_root(self, tmp_path):
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, "readme.md", "write")
        assert decision.allowed
        assert decision.resolved_path == tmp_path / "readme.md"

    def test_existing_file_inside_workspace(self, tmp_path):
        f = tmp_path / "existing.txt"
        f.write_text("data")
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, str(f), "read")
        assert decision.allowed
        assert decision.resolved_path == f


# ---------------------------------------------------------------------------
# resolve_path — denied cases
# ---------------------------------------------------------------------------


class TestResolvePathDenied:
    def test_empty_path_denied(self, tmp_path):
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, "", "read")
        assert not decision.allowed
        assert "empty" in decision.reason

    def test_traversal_outside_workspace(self, tmp_path):
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, "../outside.txt", "read")
        assert not decision.allowed
        assert decision.resolved_path is None

    def test_absolute_path_outside_workspace(self, tmp_path):
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, "/etc/passwd", "read")
        assert not decision.allowed

    def test_symlink_pointing_outside_workspace(self, tmp_path):
        """Symlink escape must be denied — strict=True follows the real path."""
        outside = tmp_path.parent / "outside_target.txt"
        outside.write_text("secret")
        link = tmp_path / "link_to_outside.txt"
        os.symlink(str(outside), str(link))

        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, str(link), "read")
        assert not decision.allowed

    def test_new_file_under_outside_parent_denied(self, tmp_path):
        """Non-existing file whose parent is outside workspace → denied."""
        outside_dir = tmp_path.parent  # exists but is not under tmp_path
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, str(outside_dir / "evil.txt"), "write")
        assert not decision.allowed

    def test_dangling_symlink_final_component_escaping_workspace_denied(self, tmp_path):
        """A symlink whose target does NOT yet exist must be denied for writes.

        The non-existing branch canonicalizes only the parent; without a
        final-component symlink guard, ``<ws>/link -> <outside-nonexisting>`` is
        classified in-workspace, and the downstream handler's ``open()`` follows
        the link and writes OUTSIDE the workspace (silent in ``full`` mode).
        """
        outside_target = tmp_path.parent / "escape_target_does_not_exist.txt"
        assert not outside_target.exists()
        link = tmp_path / "link.txt"
        os.symlink(str(outside_target), str(link))  # dangling symlink inside workspace

        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, str(link), "write")
        assert not decision.allowed
        assert decision.resolved_path is None

    def test_dangling_symlink_to_inside_workspace_allowed(self, tmp_path):
        """A symlink to a not-yet-existing target INSIDE the workspace is allowed,
        and resolves to the real in-workspace target."""
        inside_target = tmp_path / "real" / "target.txt"
        inside_target.parent.mkdir()
        link = tmp_path / "link.txt"
        os.symlink(str(inside_target), str(link))  # dangling, but points inside

        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, str(link), "write")
        assert decision.allowed
        assert decision.resolved_path == inside_target


# ---------------------------------------------------------------------------
# resolve_path — .git write protection
# ---------------------------------------------------------------------------


class TestResolvePathGitProtection:
    """Writes to .git/hooks and .git/config are denied (code execution surface);
    other .git internals and reads stay allowed so normal git keeps working."""

    def test_write_git_hook_denied(self, tmp_path):
        (tmp_path / ".git" / "hooks").mkdir(parents=True)
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, ".git/hooks/pre-commit", "write")
        assert not decision.allowed
        assert ".git" in decision.reason

    def test_write_git_config_denied(self, tmp_path):
        (tmp_path / ".git").mkdir()
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, ".git/config", "write")
        assert not decision.allowed

    def test_write_nested_repo_git_hook_denied(self, tmp_path):
        (tmp_path / "sub" / ".git" / "hooks").mkdir(parents=True)
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, "sub/.git/hooks/post-checkout", "write")
        assert not decision.allowed

    def test_write_git_objects_allowed(self, tmp_path):
        (tmp_path / ".git" / "objects" / "ab").mkdir(parents=True)
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, ".git/objects/ab/cdef", "write")
        assert decision.allowed

    def test_read_git_config_allowed(self, tmp_path):
        (tmp_path / ".git").mkdir()
        (tmp_path / ".git" / "config").write_text("[core]\n")
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, ".git/config", "read")
        assert decision.allowed


class TestResolvePathMetadataProtection:
    def test_write_protected_metadata_dirs_denied(self, tmp_path):
        snap = _snapshot(tmp_path)
        for name in (".codex", ".agents", ".hermes"):
            (tmp_path / name).mkdir()
            decision = resolve_path(snap, f"{name}/settings.json", "write")
            assert not decision.allowed
            assert name in decision.reason

    def test_create_protected_metadata_dir_denied(self, tmp_path):
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, ".codex", "write")
        assert not decision.allowed
        assert ".codex" in decision.reason

    def test_read_protected_metadata_allowed_by_python_boundary(self, tmp_path):
        (tmp_path / ".codex").mkdir()
        (tmp_path / ".codex" / "settings.json").write_text("{}", encoding="utf-8")
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, ".codex/settings.json", "read")
        assert decision.allowed

    def test_write_protected_metadata_symlink_alias_denied(self, tmp_path):
        target = tmp_path / "real-metadata"
        target.mkdir()
        (tmp_path / ".codex").symlink_to(target, target_is_directory=True)
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, ".codex/settings.json", "write")
        assert not decision.allowed
        assert ".codex" in decision.reason


class TestResolvePathGitSymlinkProtection:
    def test_write_git_config_symlink_alias_denied(self, tmp_path):
        target = tmp_path / "real-git"
        target.mkdir()
        (tmp_path / ".git").symlink_to(target, target_is_directory=True)
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, ".git/config", "write")
        assert not decision.allowed
        assert ".git" in decision.reason

    def test_write_git_hook_symlink_alias_denied(self, tmp_path):
        target = tmp_path / "real-git"
        (target / "hooks").mkdir(parents=True)
        (tmp_path / ".git").symlink_to(target, target_is_directory=True)
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, ".git/hooks/pre-commit", "write")
        assert not decision.allowed
        assert ".git" in decision.reason


# ---------------------------------------------------------------------------
# Approval key
# ---------------------------------------------------------------------------


class TestApprovalKey:
    def test_approval_key_format(self, tmp_path):
        snap = _snapshot(tmp_path)
        decision = resolve_path(snap, "file.txt", "write")
        assert decision.allowed
        key = decision.approval_key
        assert key is not None
        assert key.startswith(f"ws:{snap.workspace_hash}:write:path:")

    def test_approval_key_uses_canonical_path_not_raw(self, tmp_path):
        (tmp_path / "sub").mkdir()
        snap = _snapshot(tmp_path)
        # Pass a path with redundant components
        decision = resolve_path(snap, "sub/../sub/file.txt", "write")
        assert decision.allowed
        assert "sub/../sub" not in (decision.approval_key or "")

    def test_approval_key_changes_when_workspace_root_changes(self, tmp_path):
        """Different workspace → different hash prefix in approval key."""
        ws_a = tmp_path / "project_a"
        ws_b = tmp_path / "project_b"
        ws_a.mkdir()
        ws_b.mkdir()
        (ws_a / "file.txt").write_text("a")
        (ws_b / "file.txt").write_text("b")

        snap_a = build_workspace_policy_snapshot("s", "t", str(ws_a), "auto")
        snap_b = build_workspace_policy_snapshot("s", "t", str(ws_b), "auto")

        assert snap_a.workspace_hash != snap_b.workspace_hash

        key_a = resolve_path(snap_a, "file.txt", "write").approval_key
        key_b = resolve_path(snap_b, "file.txt", "write").approval_key

        assert key_a != key_b
        assert snap_a.workspace_hash in (key_a or "")
        assert snap_b.workspace_hash in (key_b or "")
