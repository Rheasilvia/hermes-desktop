"""Command safety classification for the desktop terminal tool.

The desktop settings UI exposes a user-editable list of dangerous command
patterns (``security.dangerous_commands`` in ``~/.hermes/config.yaml``). A
command matching any of those patterns must be routed through the human approval
flow before execution, regardless of the session's ``permissionMode`` (even in
``full`` mode). This module is the pure-function matcher for that contract.

Matching is intentionally substring-based to match the UI semantics: the user
types command fragments such as ``rm -rf`` or ``sudo``, and any terminal command
containing that fragment is treated as dangerous. This is conservative — it may
flag benign commands that merely contain a fragment — but dangerous here means
"requires approval", not "blocked", so the cost of a false positive is one extra
click rather than a denied operation.
"""
from __future__ import annotations

from typing import Iterable

# A conservative, user-overridable default set of dangerous command fragments.
# These are the patterns shipped out of the box; users add/remove via the
# Security tab (security.dangerous_commands in config.yaml).
DEFAULT_DANGEROUS_PATTERNS: list[str] = [
    "rm -rf",
    "sudo",
    "curl | sh",
    "curl|sh",
    "wget | sh",
    "wget|sh",
    "chmod 777",
    "git config core.hooksPath",
    "launchctl",
    "crontab",
    "defaults write",
]


def command_matches_patterns(command: str, patterns: Iterable[str]) -> bool:
    """Return ``True`` if ``command`` contains any of the dangerous ``patterns``.

    - Empty/whitespace-only patterns are ignored (an empty entry is a no-op, not
      a match-everything rule).
    - Matching is case-insensitive substring containment, with internal
      whitespace collapsed to single spaces on BOTH the command and each
      pattern. This lets ``curl|sh`` also catch ``curl | sh`` spacing variants
      the user may not have anticipated, and vice-versa.
    """
    if not command:
        return False
    normalized_cmd = " ".join(command.split()).lower()
    for pat in patterns:
        if pat is None:
            continue
        normalized_pat = " ".join(str(pat).split()).lower()
        if not normalized_pat:
            continue
        if normalized_pat in normalized_cmd:
            return True
    return False
