from __future__ import annotations

import os
import subprocess
import threading
import time

_FUZZY_CACHE_TTL_S = 5.0
_FUZZY_CACHE_MAX_FILES = 20_000
_FUZZY_FALLBACK_EXCLUDES = frozenset(
    {
        ".git",
        ".hg",
        ".svn",
        ".next",
        ".cache",
        ".venv",
        "venv",
        "node_modules",
        "__pycache__",
        "dist",
        "build",
        "target",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
    }
)
_fuzzy_cache_lock = threading.Lock()
_fuzzy_cache: dict[str, tuple[float, list[str]]] = {}


def _normalize_completion_path(path_part: str) -> str:
    expanded = os.path.expanduser(path_part)
    if os.name != "nt":
        normalized = expanded.replace("\\", "/")
        if (
            len(normalized) >= 3
            and normalized[1] == ":"
            and normalized[2] == "/"
            and normalized[0].isalpha()
        ):
            return f"/mnt/{normalized[0].lower()}/{normalized[3:]}"
    return expanded


def completion_root(*, cwd: str | None = None, fallback: str | None = None) -> str:
    raw = cwd or fallback or os.environ.get("TERMINAL_CWD") or os.getcwd()
    try:
        resolved = os.path.abspath(os.path.expanduser(str(raw)))
        if os.path.isdir(resolved):
            return resolved
    except Exception:
        pass
    return os.getcwd()


def _list_repo_files(root: str) -> list[str]:
    now = time.monotonic()
    with _fuzzy_cache_lock:
        cached = _fuzzy_cache.get(root)
        if cached and now - cached[0] < _FUZZY_CACHE_TTL_S:
            return cached[1]

    files: list[str] = []
    try:
        top_result = subprocess.run(
            ["git", "-C", root, "rev-parse", "--show-toplevel"],
            capture_output=True,
            timeout=2.0,
            check=False,
        )
        if top_result.returncode == 0:
            top = top_result.stdout.decode("utf-8", "replace").strip()
            list_result = subprocess.run(
                [
                    "git",
                    "-C",
                    top,
                    "ls-files",
                    "-z",
                    "--cached",
                    "--others",
                    "--exclude-standard",
                ],
                capture_output=True,
                timeout=2.0,
                check=False,
            )
            if list_result.returncode == 0:
                for path in list_result.stdout.decode("utf-8", "replace").split("\0"):
                    if not path:
                        continue
                    rel = os.path.relpath(os.path.join(top, path), root).replace(os.sep, "/")
                    if rel.startswith("../"):
                        continue
                    files.append(rel)
                    if len(files) >= _FUZZY_CACHE_MAX_FILES:
                        break
    except (OSError, subprocess.TimeoutExpired):
        pass

    if not files:
        try:
            for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
                dirnames[:] = [
                    name
                    for name in dirnames
                    if name not in _FUZZY_FALLBACK_EXCLUDES and not name.startswith(".")
                ]
                rel_dir = os.path.relpath(dirpath, root)
                for filename in filenames:
                    rel = filename if rel_dir == "." else f"{rel_dir}/{filename}"
                    files.append(rel.replace(os.sep, "/"))
                    if len(files) >= _FUZZY_CACHE_MAX_FILES:
                        break
                if len(files) >= _FUZZY_CACHE_MAX_FILES:
                    break
        except OSError:
            pass

    with _fuzzy_cache_lock:
        _fuzzy_cache[root] = (now, files)

    return files


def _fuzzy_basename_rank(name: str, query: str) -> tuple[int, int] | None:
    if not query:
        return (3, len(name))

    nl = name.lower()
    ql = query.lower()

    if nl == ql:
        return (0, len(name))
    if nl.startswith(ql):
        return (1, len(name))

    parts: list[str] = []
    buf = ""
    for ch in name:
        if ch in "-_." or (ch.isupper() and buf and not buf[-1].isupper()):
            if buf:
                parts.append(buf)
            buf = ch if ch not in "-_." else ""
        else:
            buf += ch
    if buf:
        parts.append(buf)
    for part in parts:
        if part.lower().startswith(ql):
            return (2, len(name))

    if ql in nl:
        return (3, len(name))

    index = 0
    for ch in nl:
        if ch == ql[index]:
            index += 1
            if index == len(ql):
                return (4, len(name))

    return None


def complete_path(word: str, *, root: str) -> list[dict[str, str]]:
    if not word:
        return []

    items: list[dict[str, str]] = []
    is_context = word.startswith("@")
    query = word[1:] if is_context else word

    if is_context and not query:
        return [
            {"text": "@diff", "display": "@diff", "meta": "git diff"},
            {"text": "@staged", "display": "@staged", "meta": "staged diff"},
            {"text": "@file:", "display": "@file:", "meta": "attach file"},
            {"text": "@folder:", "display": "@folder:", "meta": "attach folder"},
            {"text": "@url:", "display": "@url:", "meta": "fetch url"},
            {"text": "@git:", "display": "@git:", "meta": "git log"},
        ]

    if is_context and query in {"file", "folder"}:
        prefix_tag, path_part = query, ""
    elif is_context and query.startswith(("file:", "folder:")):
        prefix_tag, _, path_part = query.partition(":")
    else:
        prefix_tag = ""
        path_part = query if is_context else query

    if (
        is_context
        and path_part
        and len(path_part.strip()) >= 2
        and "/" not in path_part
        and prefix_tag != "folder"
    ):
        ranked: list[tuple[tuple[int, int], str, str]] = []
        for rel in _list_repo_files(root):
            basename = os.path.basename(rel)
            if basename.startswith(".") and not path_part.startswith("."):
                continue
            rank = _fuzzy_basename_rank(basename, path_part)
            if rank is None:
                continue
            ranked.append((rank, rel, basename))

        ranked.sort(key=lambda row: (row[0], len(row[1]), row[1]))
        tag = prefix_tag or "file"
        return [
            {"text": f"@{tag}:{rel}", "display": basename, "meta": os.path.dirname(rel)}
            for _, rel, basename in ranked[:30]
        ]

    expanded = _normalize_completion_path(path_part) if path_part else "."
    if expanded == "." or not expanded:
        search_dir, match = ".", ""
    elif expanded.endswith("/"):
        search_dir, match = expanded, ""
    else:
        search_dir = os.path.dirname(expanded) or "."
        match = os.path.basename(expanded)

    search_dir = search_dir if os.path.isabs(search_dir) else os.path.join(root, search_dir)
    try:
        search_abs = os.path.abspath(search_dir)
        root_abs = os.path.abspath(root)
        if not (search_abs == root_abs or search_abs.startswith(root_abs + os.sep)):
            return []
    except Exception:
        return []
    if not os.path.isdir(search_dir):
        return []

    want_dir = prefix_tag == "folder"
    match_lower = match.lower()
    for entry in sorted(os.listdir(search_dir)):
        if match and not entry.lower().startswith(match_lower):
            continue
        if is_context and entry in _FUZZY_FALLBACK_EXCLUDES:
            continue
        if is_context and not prefix_tag and entry.startswith("."):
            continue
        full = os.path.join(search_dir, entry)
        is_dir = os.path.isdir(full)
        if prefix_tag and want_dir != is_dir:
            continue
        rel = os.path.relpath(full, root).replace(os.sep, "/")
        suffix = "/" if is_dir else ""

        if is_context and prefix_tag:
            text = f"@{prefix_tag}:{rel}{suffix}"
        elif is_context:
            kind = "folder" if is_dir else "file"
            text = f"@{kind}:{rel}{suffix}"
        elif word.startswith("~"):
            text = "~/" + os.path.relpath(full, os.path.expanduser("~")) + suffix
        elif word.startswith("./"):
            text = "./" + rel + suffix
        else:
            text = rel + suffix

        items.append({"text": text, "display": entry + suffix, "meta": "dir" if is_dir else ""})
        if len(items) >= 30:
            break

    return items
