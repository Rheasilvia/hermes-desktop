"""Workspace policy snapshot and path resolution for desktop sandbox enforcement."""

from __future__ import annotations

import contextvars
import hashlib
from contextvars import Token
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WorkspacePolicySnapshot:
    session_id: str
    turn_id: str
    cwd: Path
    workspace_root: Path
    workspace_hash: str
    permission_mode: Literal["ask", "auto", "full"]
    sandbox_mode: Literal["read-only", "workspace-write"] = "workspace-write"
    network_access: Literal["restricted", "enabled"] = "restricted"
    hermes_home: Path | None = None
    protected_metadata_names: tuple[str, ...] = (".codex", ".agents", ".hermes")
    collaboration_mode: Literal["default", "plan"] = "default"
    policy_version: str = "desktop-workspace-v2"


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    requires_approval: bool
    reason: str
    resolved_path: Path | None = None
    approval_key: str | None = None


# ---------------------------------------------------------------------------
# ContextVar helpers
# ---------------------------------------------------------------------------

_SNAPSHOT_VAR: contextvars.ContextVar[WorkspacePolicySnapshot | None] = (
    contextvars.ContextVar("workspace_policy_snapshot", default=None)
)


def set_workspace_policy_snapshot(snapshot: WorkspacePolicySnapshot) -> Token:
    """Set the current workspace policy snapshot and return the reset token."""
    return _SNAPSHOT_VAR.set(snapshot)


def reset_workspace_policy_snapshot(token: Token) -> None:
    """Reset the workspace policy snapshot to its previous value via token."""
    _SNAPSHOT_VAR.reset(token)


def get_workspace_policy_snapshot() -> WorkspacePolicySnapshot | None:
    """Return the current workspace policy snapshot, or None if unset."""
    return _SNAPSHOT_VAR.get()


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------


# Security contract: approval cannot expand workspace containment.
# Outside-workspace path denials are final regardless of permissionMode.
# permissionMode ("ask", "auto", "full") only controls prompts for operations
# INSIDE workspace; it never grants outside-workspace file access.

_VALID_PERMISSION_MODES = {"ask", "auto", "full"}
_VALID_COLLABORATION_MODES = {"default", "plan"}
_VALID_SANDBOX_MODES = {"read-only", "workspace-write"}
_VALID_NETWORK_ACCESS = {"restricted", "enabled"}
_DEFAULT_PROTECTED_METADATA_NAMES = (".codex", ".agents", ".hermes")


def _normalized_relative_parts(path: Path, root: Path) -> tuple[str, ...] | None:
    """Return lexical relative parts without following symlinks.

    ``Path.resolve()`` intentionally follows parent symlinks. For write-protected
    names like ``.codex`` and ``.git/config`` we also need to honor the logical
    path the caller supplied, so ``.codex -> real-dir`` cannot bypass a deny rule.
    """
    try:
        rel = path.relative_to(root)
    except ValueError:
        return None
    parts: list[str] = []
    for part in rel.parts:
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
                continue
            return None
        parts.append(part)
    return tuple(parts)


def _protected_write_reason(
    snapshot: WorkspacePolicySnapshot,
    rel_parts: tuple[str, ...],
) -> str | None:
    protected = set(getattr(snapshot, "protected_metadata_names", _DEFAULT_PROTECTED_METADATA_NAMES))
    for part in rel_parts:
        if part in protected:
            return f"{part} is read-only inside the workspace"
    if ".git" in rel_parts:
        tail = rel_parts[rel_parts.index(".git") + 1:]
        if tail[:1] in (("hooks",), ("config",)):
            return ".git/hooks and .git/config are read-only inside the workspace"
    return None


def build_workspace_policy_snapshot(
    session_id: str,
    turn_id: str,
    cwd: str | Path,
    permission_mode: Literal["ask", "auto", "full"],
    collaboration_mode: Literal["default", "plan"] = "default",
    sandbox_mode: Literal["read-only", "workspace-write"] = "workspace-write",
    network_access: Literal["restricted", "enabled"] = "restricted",
    hermes_home: str | Path | None = None,
    protected_metadata_names: tuple[str, ...] | None = None,
) -> WorkspacePolicySnapshot:
    """Build a snapshot from the given working directory.

    Raises ValueError if cwd does not exist or is not a directory.
    """
    canonical = Path(cwd).expanduser().resolve(strict=True)
    if not canonical.is_dir():  # strict=True follows symlinks; catches symlink-to-file inputs
        raise ValueError(f"workspace path is not a directory: {cwd}")

    if permission_mode not in _VALID_PERMISSION_MODES:
        raise ValueError(f"invalid permission_mode {permission_mode!r}; expected one of {sorted(_VALID_PERMISSION_MODES)}")
    if collaboration_mode not in _VALID_COLLABORATION_MODES:
        raise ValueError(f"invalid collaboration_mode {collaboration_mode!r}; expected one of {sorted(_VALID_COLLABORATION_MODES)}")
    if sandbox_mode not in _VALID_SANDBOX_MODES:
        raise ValueError(f"invalid sandbox_mode {sandbox_mode!r}; expected one of {sorted(_VALID_SANDBOX_MODES)}")
    if network_access not in _VALID_NETWORK_ACCESS:
        raise ValueError(f"invalid network_access {network_access!r}; expected one of {sorted(_VALID_NETWORK_ACCESS)}")

    workspace_hash = hashlib.sha256(str(canonical).encode()).hexdigest()[:16]
    resolved_hermes_home: Path | None = None
    if hermes_home is not None:
        resolved_hermes_home = Path(hermes_home).expanduser().resolve()

    return WorkspacePolicySnapshot(
        session_id=session_id,
        turn_id=turn_id,
        cwd=canonical,
        workspace_root=canonical,
        workspace_hash=workspace_hash,
        permission_mode=permission_mode,
        sandbox_mode=sandbox_mode,
        network_access=network_access,
        hermes_home=resolved_hermes_home,
        protected_metadata_names=tuple(protected_metadata_names or _DEFAULT_PROTECTED_METADATA_NAMES),
        collaboration_mode=collaboration_mode,
    )


# ---------------------------------------------------------------------------
# Path resolution
# ---------------------------------------------------------------------------


def _make_approval_key(
    snapshot: WorkspacePolicySnapshot,
    access: str,
    resolved: Path,
) -> str:
    """Build an approval key from canonical resolved path, never raw caller path."""
    # workspace_hash prefix prevents approval reuse after switching workspace roots
    return f"ws:{snapshot.workspace_hash}:{access}:path:{resolved}"


def resolve_path(
    snapshot: WorkspacePolicySnapshot,
    path: str,
    access: str,
) -> PolicyDecision:
    """Resolve *path* against *snapshot* and return a PolicyDecision.

    Rules:
    - Empty path → denied.
    - Relative paths → resolved against snapshot.cwd.
    - Existing targets → canonicalized with strict=True (follows symlinks to real path).
    - Non-existing write targets → parent canonicalized with strict=True, filename appended.
    - Final canonical path must be under snapshot.workspace_root.

    Note: ``requires_approval`` is always False from this function; it is
    reserved for the enforcement layer (Task 4) which may upgrade decisions
    to require human approval based on permission_mode and operation type.
    """
    if not path or not path.strip():
        return PolicyDecision(
            allowed=False,
            requires_approval=False,
            reason="path must not be empty",
        )

    raw = Path(path).expanduser()

    # Make absolute relative to cwd
    if not raw.is_absolute():
        raw = snapshot.cwd / raw
    logical_rel_parts = _normalized_relative_parts(raw, snapshot.workspace_root)

    # Try to canonicalize — if the target exists, use strict resolution
    if raw.exists():
        try:
            canonical = raw.resolve(strict=True)
        except OSError as exc:
            return PolicyDecision(
                allowed=False,
                requires_approval=False,
                reason=f"could not resolve path: {exc}",
            )
    else:
        # For non-existing paths (write to new file): canonicalize parent
        parent = raw.parent
        filename = raw.name
        try:
            canonical_parent = parent.resolve(strict=True)
        except OSError as exc:
            return PolicyDecision(
                allowed=False,
                requires_approval=False,
                reason=f"parent directory does not exist or cannot be resolved: {exc}",
            )
        canonical = canonical_parent / filename
        # The final path component may itself be a (possibly dangling) symlink.
        # ``Path.resolve()`` / ``open()`` in the downstream handler would FOLLOW
        # it, so ``<ws>/link -> <outside>`` must be resolved to its real target
        # and re-checked for containment below; otherwise a write through the
        # link escapes the workspace (silent in ``full`` permission mode).
        if raw.is_symlink():
            canonical = raw.resolve()

    # Enforce workspace containment
    try:
        canonical.relative_to(snapshot.workspace_root)
    except ValueError:
        return PolicyDecision(
            allowed=False,
            requires_approval=False,
            reason=(
                f"path escapes workspace root "
                f"({canonical} not under {snapshot.workspace_root})"
            ),
        )

    # .git/hooks and .git/config are an unsandboxed code-execution surface: a
    # hook runs on the next git operation, and config can set core.hooksPath,
    # core.fsmonitor, core.pager or `!`-aliases. Deny WRITES there (any nested
    # repo too) while leaving other .git internals and all reads working so
    # normal git operations are unaffected.
    if access == "write":
        rel_parts = canonical.relative_to(snapshot.workspace_root).parts
        for candidate_parts in (logical_rel_parts, rel_parts):
            if candidate_parts is None:
                continue
            reason = _protected_write_reason(snapshot, candidate_parts)
            if reason is not None:
                return PolicyDecision(
                    allowed=False,
                    requires_approval=False,
                    reason=reason,
                )

    approval_key = _make_approval_key(snapshot, access, canonical)
    return PolicyDecision(
        allowed=True,
        requires_approval=False,
        reason="path is within workspace",
        resolved_path=canonical,
        approval_key=approval_key,
    )


# Used by desktop tool wrappers to check approval candidates against workspace boundary.
def is_workspace_internal(snapshot: WorkspacePolicySnapshot, resolved_path: Path) -> bool:
    """Return True only when resolved_path is contained within snapshot.workspace_root."""
    try:
        resolved_path.relative_to(snapshot.workspace_root)
        return True
    except ValueError:
        return False


__all__ = [
    "WorkspacePolicySnapshot",
    "PolicyDecision",
    "set_workspace_policy_snapshot",
    "reset_workspace_policy_snapshot",
    "get_workspace_policy_snapshot",
    "build_workspace_policy_snapshot",
    "resolve_path",
    "is_workspace_internal",
]
