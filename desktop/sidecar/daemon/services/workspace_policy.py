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
    policy_version: str = "desktop-workspace-v1"


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


_VALID_PERMISSION_MODES = {"ask", "auto", "full"}


def build_workspace_policy_snapshot(
    session_id: str,
    turn_id: str,
    cwd: str | Path,
    permission_mode: Literal["ask", "auto", "full"],
) -> WorkspacePolicySnapshot:
    """Build a snapshot from the given working directory.

    Raises ValueError if cwd does not exist or is not a directory.
    """
    canonical = Path(cwd).expanduser().resolve(strict=True)
    if not canonical.is_dir():  # strict=True follows symlinks; catches symlink-to-file inputs
        raise ValueError(f"workspace path is not a directory: {cwd}")

    if permission_mode not in _VALID_PERMISSION_MODES:
        permission_mode = "auto"

    workspace_hash = hashlib.sha256(str(canonical).encode()).hexdigest()[:16]

    return WorkspacePolicySnapshot(
        session_id=session_id,
        turn_id=turn_id,
        cwd=canonical,
        workspace_root=canonical,
        workspace_hash=workspace_hash,
        permission_mode=permission_mode,
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

    approval_key = _make_approval_key(snapshot, access, canonical)
    return PolicyDecision(
        allowed=True,
        requires_approval=False,
        reason="path is within workspace",
        resolved_path=canonical,
        approval_key=approval_key,
    )


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
