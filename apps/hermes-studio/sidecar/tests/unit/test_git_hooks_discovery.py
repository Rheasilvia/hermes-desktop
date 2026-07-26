"""Unit + integration tests for nested/bare repo ``.git/hooks`` discovery.

The seatbelt sandbox must write-deny ``.git/hooks`` for *every* git repository
under the workspace, not just the top-level one. An agent that plants a hook in
a nested/bare repo gets code execution on the next git operation, so coverage
of those paths is a security requirement, not convenience.

Coverage:
  1. ``_discover_git_hook_dirs`` finds top-level, bare, nested, and submodule
     (gitdir pointer) hooks dirs.
  2. Gitdir pointers resolving *outside* the workspace are skipped (already
     write-denied by the L1 boundary).
  3. ``maxdepth`` caps descent.
  4. The generated policy emits one ``WS_GIT_HOOK_N`` deny rule per discovery,
     paths passed via ``-D`` params (never interpolated).
  5. Real ``/usr/bin/sandbox-exec`` integration: writes to each discovered
     hooks dir are rejected, and normal git operations still work.
"""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

def _can_apply_seatbelt() -> bool:
    if sys.platform != "darwin" or not os.path.exists("/usr/bin/sandbox-exec"):
        return False
    try:
        result = subprocess.run(
            ["/usr/bin/sandbox-exec", "-p", "(version 1)\n(allow default)", "--", "/usr/bin/true"],
            capture_output=True,
            timeout=2.0,
            check=False,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


_HAS_SEATBELT = _can_apply_seatbelt()


# ---------------------------------------------------------------------------
# _discover_git_hook_dirs
# ---------------------------------------------------------------------------


def _run_git(*args, cwd: str | None = None) -> None:
    """Run git; args may include the target path (``git init <path>``) or use cwd."""
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


class TestDiscoverGitHookDirs:
    def test_finds_top_level_hooks(self, tmp_path):
        from daemon.services.sandbox_runner import _discover_git_hook_dirs

        (tmp_path / ".git" / "hooks").mkdir(parents=True)
        found = _discover_git_hook_dirs(str(tmp_path))
        assert (tmp_path / ".git" / "hooks").resolve() in found

    def test_finds_bare_repo_hooks(self, tmp_path):
        """A bare repo ``vendor/sub.git/hooks`` must be discovered."""
        from daemon.services.sandbox_runner import _discover_git_hook_dirs

        (tmp_path / ".git" / "hooks").mkdir(parents=True)
        (tmp_path / "vendor" / "sub.git" / "hooks").mkdir(parents=True)
        found = _discover_git_hook_dirs(str(tmp_path))
        found_str = {str(p) for p in found}
        assert str((tmp_path / ".git" / "hooks").resolve()) in found_str
        assert str((tmp_path / "vendor" / "sub.git" / "hooks").resolve()) in found_str

    def test_finds_nested_working_clone(self, tmp_path):
        """A nested working clone ``mono/a/.git/hooks`` must be discovered."""
        from daemon.services.sandbox_runner import _discover_git_hook_dirs

        (tmp_path / "mono" / "a" / ".git" / "hooks").mkdir(parents=True)
        found = _discover_git_hook_dirs(str(tmp_path))
        found_str = {str(p) for p in found}
        assert str((tmp_path / "mono" / "a" / ".git" / "hooks").resolve()) in found_str

    def test_finds_in_workspace_submodule_pointer(self, tmp_path):
        """A ``.git`` *file* (gitdir pointer) resolving inside the workspace counts."""
        from daemon.services.sandbox_runner import _discover_git_hook_dirs

        # The real modules dir git would use under <ws>/.git/modules/sub
        modules_hooks = tmp_path / ".git" / "modules" / "sub" / "hooks"
        modules_hooks.mkdir(parents=True)
        # Submodule checkout directory with a .git file pointing at it.
        sub_dir = tmp_path / "external" / "sub"
        sub_dir.mkdir(parents=True)
        pointer = sub_dir / ".git"
        pointer.write_text(f"gitdir: {tmp_path}/.git/modules/sub\n", encoding="utf-8")

        found = _discover_git_hook_dirs(str(tmp_path))
        found_str = {str(p) for p in found}
        assert str(modules_hooks.resolve()) in found_str

    def test_skips_outside_workspace_gitdir_pointer(self, tmp_path):
        """A gitdir pointer resolving outside the workspace is skipped (L1 covers it)."""
        from daemon.services.sandbox_runner import _discover_git_hook_dirs

        outside = tmp_path.parent / "outside-modules" / "hooks"
        outside.mkdir(parents=True)
        try:
            sub_dir = tmp_path / "leak"
            sub_dir.mkdir()
            pointer = sub_dir / ".git"
            pointer.write_text(f"gitdir: {outside.parent}\n", encoding="utf-8")

            found = _discover_git_hook_dirs(str(tmp_path))
            found_str = {str(p) for p in found}
            assert str(outside.resolve()) not in found_str
        finally:
            # tmp_path.parent is shared test scratch space; clean our addition.
            import shutil

            shutil.rmtree(outside.parent, ignore_errors=True)

    def test_maxdepth_caps_descent(self, tmp_path):
        """A nested repo deeper than maxdepth is not discovered."""
        from daemon.services.sandbox_runner import _discover_git_hook_dirs

        deep = tmp_path / "a" / "b" / "c" / "d" / ".git" / "hooks"
        deep.mkdir(parents=True)
        # maxdepth=2 -> only <ws>/a and <ws>/a/b inspected; the repo at depth 4 is skipped.
        found = _discover_git_hook_dirs(str(tmp_path), maxdepth=2)
        found_str = {str(p) for p in found}
        assert str(deep.resolve()) not in found_str

    def test_dedupes(self, tmp_path):
        """Calling discovery twice is stable and de-duplicated."""
        from daemon.services.sandbox_runner import _discover_git_hook_dirs

        (tmp_path / ".git" / "hooks").mkdir(parents=True)
        first = _discover_git_hook_dirs(str(tmp_path))
        second = _discover_git_hook_dirs(str(tmp_path))
        assert first == second
        assert len(first) == len({str(p) for p in first})

    def test_nonexistent_hooks_dir_not_listed(self, tmp_path):
        """If .git exists but has no hooks subdir, nothing is returned for it."""
        from daemon.services.sandbox_runner import _discover_git_hook_dirs

        (tmp_path / ".git").mkdir(parents=True)  # no hooks subdir
        found = _discover_git_hook_dirs(str(tmp_path))
        assert found == []


# ---------------------------------------------------------------------------
# Policy generation (multi-deny)
# ---------------------------------------------------------------------------


class TestPolicyGitHooksDeny:
    def test_policy_emits_one_deny_per_discovered_hooks_dir(self, tmp_path):
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        (tmp_path / ".git" / "hooks").mkdir(parents=True)
        (tmp_path / "vendor" / "x.git" / "hooks").mkdir(parents=True)
        (tmp_path / "mono" / "y" / ".git" / "hooks").mkdir(parents=True)

        policy, params = _build_seatbelt_policy(str(tmp_path))

        # Three WS_GIT_HOOK_N params, indexed 0..2.
        hook_params = sorted(k for k, _ in params if k.startswith("WS_GIT_HOOK_"))
        assert hook_params == ["WS_GIT_HOOK_0", "WS_GIT_HOOK_1", "WS_GIT_HOOK_2"]
        for key in hook_params:
            assert f'(deny file-write* (subpath (param "{key}")))' in policy

    def test_policy_paths_not_interpolated(self, tmp_path):
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        hooks = tmp_path / ".git" / "hooks"
        hooks.mkdir(parents=True)
        policy, params = _build_seatbelt_policy(str(tmp_path))

        assert ("WS_GIT_HOOK_0", str(hooks.resolve())) in params
        # The literal hooks path must NOT appear in the policy text (anti-injection).
        assert str(hooks.resolve()) not in policy

    def test_policy_no_legacy_single_key(self, tmp_path):
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        (tmp_path / ".git" / "hooks").mkdir(parents=True)
        policy, params = _build_seatbelt_policy(str(tmp_path))
        assert "WS_GIT_HOOKS" not in policy
        assert not any(k == "WS_GIT_HOOKS" for k, _ in params)


# ---------------------------------------------------------------------------
# Real seatbelt integration (macOS only)
# ---------------------------------------------------------------------------


@pytest.mark.skipif(not _HAS_SEATBELT, reason="requires macOS sandbox-exec")
class TestSeatbeltIntegration:
    """Spin up real git repos and run sandbox-exec to confirm enforcement."""

    def test_writes_to_nested_hooks_are_denied(self, tmp_path):
        from daemon.services.sandbox_runner import _build_seatbelt_policy

        # Build a real top-level repo and a bare nested repo.
        _run_git("init", "-q", str(tmp_path))
        _run_git("-C", str(tmp_path), "config", "user.email", "t@t")
        _run_git("-C", str(tmp_path), "config", "user.name", "t")
        _run_git("init", "--bare", "-q", str(tmp_path / "vendor" / "sub.git"))
        policy, params = _build_seatbelt_policy(str(tmp_path))
        define_args = [f"-D{k}={v}" for k, v in params]

        def _write_denied(target_dir: str) -> bool:
            argv = [
                "/usr/bin/sandbox-exec", "-p", policy, *define_args, "--",
                "/bin/sh", "-c", f"echo x > '{target_dir}/evil-hook'",
            ]
            proc = subprocess.run(argv, capture_output=True, text=True)
            # seatbelt denies surface as non-zero exit + Operation not permitted.
            return proc.returncode != 0

        assert _write_denied(str((tmp_path / ".git" / "hooks").resolve()))
        assert _write_denied(
            str((tmp_path / "vendor" / "sub.git" / "hooks").resolve())
        )

    def test_normal_git_operations_still_work(self, tmp_path):
        """Guard against over-protection: ordinary git ops must succeed in-sandbox."""
        from daemon.services.sandbox_runner import _build_seatbelt_policy, with_workspace_scratch_env

        _run_git("init", "-q", str(tmp_path))
        _run_git("-C", str(tmp_path), "config", "user.email", "t@t")
        _run_git("-C", str(tmp_path), "config", "user.name", "t")
        policy, params = _build_seatbelt_policy(str(tmp_path))
        define_args = [f"-D{k}={v}" for k, v in params]
        env = with_workspace_scratch_env(os.environ.copy(), tmp_path)

        (tmp_path / "README").write_text("hello\n", encoding="utf-8")

        for cmd in (["git", "status"], ["git", "add", "README"],
                    ["git", "log"], ["git", "diff"]):
            argv = [
                "/usr/bin/sandbox-exec", "-p", policy, *define_args, "--", *cmd
            ]
            proc = subprocess.run(argv, cwd=str(tmp_path), env=env, capture_output=True, text=True)
            # git log on an empty repo exits non-zero; treat that as acceptable.
            # The security-relevant assertion is that it is NOT a seatbelt denial
            # (no "Operation not permitted" / sandbox violation in stderr).
            assert "Operation not permitted" not in proc.stderr, (
                f"git op {cmd} was blocked by seatbelt: {proc.stderr}"
            )
