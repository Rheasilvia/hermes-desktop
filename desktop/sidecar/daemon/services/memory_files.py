"""Memory file service: enumeration, safe path resolution, read, write, search.

Single chokepoint for all memory file I/O on the desktop backend. Handlers in
``routers/memory.py`` MUST go through ``resolve_safe_path`` and the helpers
defined here; they must not construct paths inline.

Layered model:
    - User scope:  files anchored at ``cfg.hermes_home``
    - Project scope: files anchored at a workspace path drawn from the
      ``session_desktop_meta`` table in ``desktop/desktop.db``

Only whitelisted ``well_known_name`` values are permitted; everything else
fails Pydantic validation upstream and ``MemoryPathInvalidError`` here.
"""
from __future__ import annotations

import os
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Iterator, Literal, Optional, Sequence

from .exceptions import (
    MemoryConcurrentWriteError,
    MemoryEncodingError,
    MemoryFileNotFoundError,
    MemoryFileTooLargeError,
    MemoryPathInvalidError,
)


# ── Constants ────────────────────────────────────────────────────────────

Scope = Literal["user", "project"]

# Read cap is intentionally larger than the write cap: a user may already have
# a large file on disk that we want to surface, but we should refuse to accept
# very large new content from the UI.
READ_CAP_BYTES = 5 * 1024 * 1024
WRITE_CAP_BYTES = 1 * 1024 * 1024

# Snippet length around each search match.
SNIPPET_RADIUS = 80


class WellKnownMemoryFile(str, Enum):
    """All file paths the Memory Manager is allowed to touch.

    Values are scope-relative POSIX paths. The Pydantic schema layer pins
    ``well_known_name`` to ``Literal[*ALL_NAMES]`` so non-whitelist values
    fail at parse time (HTTP 422), never reaching this module.
    """

    # User-scope (anchored at ``cfg.hermes_home``)
    USER_AGENTS = "AGENTS.md"
    USER_MEMORY = "memories/MEMORY.md"
    USER_USER = "memories/USER.md"

    # Project-scope (anchored at a workspace root)
    PROJECT_CLAUDE = "CLAUDE.md"
    PROJECT_CONTEXT = ".hermes/context.md"
    PROJECT_MEMORY = ".hermes/memories/MEMORY.md"


# Note: ``AGENTS.md`` is shared between user and project scope; the Enum
# de-duplicates by value, so we keep ordered tuples per scope as the source
# of truth for enumeration order.
USER_FILES: tuple[str, ...] = (
    "AGENTS.md",
    "memories/MEMORY.md",
    "memories/USER.md",
)

PROJECT_FILES: tuple[str, ...] = (
    "AGENTS.md",
    "CLAUDE.md",
    ".hermes/context.md",
    ".hermes/memories/MEMORY.md",
)

ALL_NAMES: tuple[str, ...] = tuple(sorted(set(USER_FILES + PROJECT_FILES)))


def files_for_scope(scope: Scope) -> tuple[str, ...]:
    """Return the ordered whitelist of well-known names for the given scope."""
    if scope == "user":
        return USER_FILES
    if scope == "project":
        return PROJECT_FILES
    raise MemoryPathInvalidError(f"Unknown scope: {scope}")


# ── Data shapes ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class MemoryFileInfo:
    """File metadata returned to the UI tree.

    ``modified_at`` is ISO 8601 UTC with microsecond precision when the file
    exists, or ``None`` otherwise. The string representation is what the UI
    sends back as ``If-Match`` on PUT.
    """

    scope: Scope
    workspace_path: Optional[str]
    well_known_name: str
    abs_path: str
    exists: bool
    size_bytes: int
    modified_at: Optional[str]


@dataclass(frozen=True)
class MemoryFileWithContent:
    info: MemoryFileInfo
    content: str


@dataclass(frozen=True)
class MemorySearchHit:
    info: MemoryFileInfo
    line_number: int  # 1-based
    snippet: str
    match_count: int


@dataclass(frozen=True)
class MemoryProject:
    workspace_path: str
    last_used_at: str  # ISO 8601 UTC
    session_count: int


# ── Path resolution ──────────────────────────────────────────────────────


def resolve_safe_path(
    scope: Scope,
    workspace: Optional[str],
    name: str,
    *,
    hermes_home: Path,
    known_workspaces: Sequence[str],
) -> Path:
    """Resolve a ``(scope, workspace, name)`` triple to an absolute path.

    Rejects path traversal, unknown workspaces, and out-of-whitelist names.
    Every handler in ``routers/memory.py`` MUST call this before touching the
    filesystem.
    """
    if name not in ALL_NAMES:
        raise MemoryPathInvalidError(f"Not in whitelist: {name!r}")

    # Defense in depth: even though Literal validation rejects path separators
    # at the schema layer, double-check here in case this function is called
    # from internal code that bypassed Pydantic.
    if ".." in Path(name).parts:
        raise MemoryPathInvalidError(f"Path traversal in name: {name!r}")
    if Path(name).is_absolute():
        raise MemoryPathInvalidError(f"Absolute name not allowed: {name!r}")

    if scope == "user":
        if name not in USER_FILES:
            raise MemoryPathInvalidError(
                f"{name!r} is not a user-scope file"
            )
        root = hermes_home.resolve()
    elif scope == "project":
        if name not in PROJECT_FILES:
            raise MemoryPathInvalidError(
                f"{name!r} is not a project-scope file"
            )
        if not workspace:
            raise MemoryPathInvalidError(
                "workspace is required for project scope"
            )
        if workspace not in known_workspaces:
            raise MemoryPathInvalidError(
                f"workspace not in known projects: {workspace!r}"
            )
        root = Path(workspace).resolve()
    else:
        raise MemoryPathInvalidError(f"Unknown scope: {scope}")

    candidate = (root / name).resolve()

    # Final safety: candidate must be a descendant of root after resolution.
    # ``Path.resolve()`` collapses symlinks and ``..`` segments; this catches
    # any escape attempt.
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise MemoryPathInvalidError(
            f"Resolved path escapes root: {candidate} not under {root}"
        ) from exc

    return candidate


# ── File metadata + I/O helpers ──────────────────────────────────────────


def _format_mtime(stat_result: os.stat_result) -> str:
    """Format ``st_mtime`` as ISO 8601 UTC with microsecond precision.

    Always produces the same string for the same on-disk mtime, so optimistic
    concurrency checks can compare server-formatted strings directly.
    """
    return datetime.fromtimestamp(stat_result.st_mtime, tz=timezone.utc).isoformat()


def _stat_info(
    *,
    scope: Scope,
    workspace: Optional[str],
    name: str,
    abs_path: Path,
) -> MemoryFileInfo:
    """Build ``MemoryFileInfo`` by stat-ing the path. Missing files are OK."""
    try:
        st = abs_path.stat()
    except FileNotFoundError:
        return MemoryFileInfo(
            scope=scope,
            workspace_path=workspace,
            well_known_name=name,
            abs_path=str(abs_path),
            exists=False,
            size_bytes=0,
            modified_at=None,
        )
    return MemoryFileInfo(
        scope=scope,
        workspace_path=workspace,
        well_known_name=name,
        abs_path=str(abs_path),
        exists=True,
        size_bytes=st.st_size,
        modified_at=_format_mtime(st),
    )


def list_files(
    scope: Scope,
    workspace: Optional[str],
    *,
    hermes_home: Path,
    known_workspaces: Sequence[str],
) -> list[MemoryFileInfo]:
    """Return the whitelist for ``scope`` with current existence + metadata.

    Files that do not exist on disk are still returned with ``exists=False``
    so the UI tree shape stays stable.
    """
    names = files_for_scope(scope)
    out: list[MemoryFileInfo] = []
    for name in names:
        abs_path = resolve_safe_path(
            scope,
            workspace,
            name,
            hermes_home=hermes_home,
            known_workspaces=known_workspaces,
        )
        out.append(_stat_info(scope=scope, workspace=workspace, name=name, abs_path=abs_path))
    return out


def read_file(
    scope: Scope,
    workspace: Optional[str],
    name: str,
    *,
    hermes_home: Path,
    known_workspaces: Sequence[str],
) -> MemoryFileWithContent:
    """Read a whitelisted file, enforcing read cap and UTF-8."""
    abs_path = resolve_safe_path(
        scope,
        workspace,
        name,
        hermes_home=hermes_home,
        known_workspaces=known_workspaces,
    )
    info = _stat_info(scope=scope, workspace=workspace, name=name, abs_path=abs_path)
    if not info.exists:
        raise MemoryFileNotFoundError(str(abs_path))

    if info.size_bytes > READ_CAP_BYTES:
        raise MemoryFileTooLargeError(
            f"{abs_path} is {info.size_bytes} bytes; cap {READ_CAP_BYTES}"
        )

    try:
        content = abs_path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise MemoryEncodingError(
            f"{abs_path} is not valid UTF-8: {exc}"
        ) from exc

    return MemoryFileWithContent(info=info, content=content)


def write_file(
    scope: Scope,
    workspace: Optional[str],
    name: str,
    content: str,
    if_match: Optional[str],
    *,
    hermes_home: Path,
    known_workspaces: Sequence[str],
) -> MemoryFileWithContent:
    """Atomically write a whitelisted file with optimistic concurrency.

    If the file already exists and ``if_match`` is provided, it must equal the
    current ``modified_at``. A missing file may be created by passing
    ``if_match=None`` (or an empty string).

    Atomic write: temp file in the same parent directory + ``os.replace``,
    so a crash mid-write never leaves a partially written file.
    """
    if len(content.encode("utf-8")) > WRITE_CAP_BYTES:
        raise MemoryFileTooLargeError(
            f"content is {len(content.encode('utf-8'))} bytes; cap {WRITE_CAP_BYTES}"
        )

    abs_path = resolve_safe_path(
        scope,
        workspace,
        name,
        hermes_home=hermes_home,
        known_workspaces=known_workspaces,
    )
    current = _stat_info(scope=scope, workspace=workspace, name=name, abs_path=abs_path)

    # Optimistic concurrency: if the file exists and the caller supplied
    # If-Match, the on-disk mtime must match. Attach the current
    # info+content to the exception so the HTTP layer can return it in the
    # conflict body (saves the client a follow-up GET).
    if current.exists and if_match and current.modified_at != if_match:
        try:
            current_text = abs_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            current_text = ""
        current_payload = {
            **{
                "scope": current.scope,
                "workspace_path": current.workspace_path,
                "well_known_name": current.well_known_name,
                "abs_path": current.abs_path,
                "exists": current.exists,
                "size_bytes": current.size_bytes,
                "modified_at": current.modified_at,
            },
            "content": current_text,
        }
        raise MemoryConcurrentWriteError(
            f"on-disk modified_at={current.modified_at!r}, "
            f"If-Match={if_match!r}",
            current=current_payload,
        )

    abs_path.parent.mkdir(parents=True, exist_ok=True)

    # Atomic rename within the same directory.
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{abs_path.name}.",
        suffix=".tmp",
        dir=str(abs_path.parent),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            tmp.write(content)
        os.replace(tmp_path, abs_path)
    except Exception:
        # Best-effort cleanup; ``os.replace`` already moved the file on
        # success so this only runs on the error path.
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    fresh = _stat_info(scope=scope, workspace=workspace, name=name, abs_path=abs_path)
    return MemoryFileWithContent(info=fresh, content=content)


# ── Search ───────────────────────────────────────────────────────────────


def _iter_searchable_files(
    scope_filter: Optional[Scope],
    workspace_filter: Optional[str],
    *,
    hermes_home: Path,
    known_workspaces: Sequence[str],
) -> Iterator[MemoryFileInfo]:
    """Yield existing whitelisted files matching the optional filters.

    Falls back to all scopes when ``scope_filter`` is ``None``.
    """
    if scope_filter in (None, "user"):
        for info in list_files(
            "user",
            None,
            hermes_home=hermes_home,
            known_workspaces=known_workspaces,
        ):
            if info.exists:
                yield info

    if scope_filter in (None, "project"):
        # If a workspace filter is given, search only that workspace; else
        # search every known project workspace.
        ws_iter = (
            [workspace_filter]
            if workspace_filter
            else list(known_workspaces)
        )
        for ws in ws_iter:
            try:
                infos = list_files(
                    "project",
                    ws,
                    hermes_home=hermes_home,
                    known_workspaces=known_workspaces,
                )
            except MemoryPathInvalidError:
                # Stale workspace_path in sessions DB; skip silently.
                continue
            for info in infos:
                if info.exists:
                    yield info


def search(
    query: str,
    scope: Optional[Scope],
    workspace: Optional[str],
    *,
    hermes_home: Path,
    known_workspaces: Sequence[str],
    max_hits_per_file: int = 50,
    max_total_hits: int = 500,
) -> list[MemorySearchHit]:
    """Naive case-insensitive substring search across whitelisted files.

    Bounded by ``max_hits_per_file`` and ``max_total_hits`` to keep responses
    sane on large files. Files that fail to read (oversize, bad encoding) are
    skipped silently rather than aborting the whole search.
    """
    needle = query.strip().lower()
    if not needle:
        return []

    hits: list[MemorySearchHit] = []
    for info in _iter_searchable_files(
        scope,
        workspace,
        hermes_home=hermes_home,
        known_workspaces=known_workspaces,
    ):
        try:
            text = Path(info.abs_path).read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        per_file = 0
        for line_idx, line in enumerate(text.splitlines(), start=1):
            lower = line.lower()
            count = lower.count(needle)
            if count == 0:
                continue
            # Build snippet centred on the first match.
            first = lower.find(needle)
            start = max(0, first - SNIPPET_RADIUS)
            end = min(len(line), first + len(needle) + SNIPPET_RADIUS)
            snippet = line[start:end]
            if start > 0:
                snippet = "…" + snippet
            if end < len(line):
                snippet = snippet + "…"

            hits.append(
                MemorySearchHit(
                    info=info,
                    line_number=line_idx,
                    snippet=snippet,
                    match_count=count,
                )
            )
            per_file += 1
            if per_file >= max_hits_per_file:
                break
            if len(hits) >= max_total_hits:
                return hits

    return hits


# ── Project list (sessions table) ────────────────────────────────────────


def list_known_workspaces(hermes_home: Path) -> list[str]:
    """Return distinct desktop session cwd values from state.db."""
    try:
        conn = sqlite3.connect(str(Path(hermes_home) / "state.db"))
    except Exception:
        return []
    try:
        rows = conn.execute(
            "SELECT DISTINCT cwd FROM sessions "
            "WHERE source = 'desktop' AND cwd IS NOT NULL AND cwd != ''"
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()
    return [str(row[0]) for row in rows]


def list_projects(hermes_home: Path) -> list[MemoryProject]:
    """Return ordered project list for the Manager picker.

    Sorts by most-recent desktop session activity from state.db.
    """
    try:
        conn = sqlite3.connect(str(Path(hermes_home) / "state.db"))
    except Exception:
        return []
    try:
        rows = conn.execute(
            """
            SELECT cwd,
                   MAX(started_at) AS last_used_at,
                   COUNT(*) AS session_count
            FROM sessions
            WHERE source = 'desktop' AND cwd IS NOT NULL AND cwd != ''
            GROUP BY cwd
            ORDER BY last_used_at DESC
            """
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    finally:
        conn.close()

    out: list[MemoryProject] = []
    for ws, last, count in rows:
        try:
            iso = datetime.fromtimestamp(float(last), tz=timezone.utc).isoformat()
        except (TypeError, ValueError):
            iso = ""
        out.append(
            MemoryProject(
                workspace_path=str(ws),
                last_used_at=iso,
                session_count=int(count),
            )
        )
    return out
