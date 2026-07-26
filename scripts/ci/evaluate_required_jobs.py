#!/usr/bin/env python3
"""Evaluate the terminal results of jobs required by the CI orchestrator."""

from __future__ import annotations

import json
import os
import sys
from typing import Any


def _output(needs: dict[str, Any], job: str, key: str) -> str:
    return str(needs.get(job, {}).get("outputs", {}).get(key, ""))


def _enabled(needs: dict[str, Any], key: str) -> bool:
    return _output(needs, "detect", key) == "true"


def expected_skip(job: str, needs: dict[str, Any]) -> bool:
    """Return whether the orchestrator condition intentionally skips ``job``."""
    event_name = _output(needs, "detect", "event_name")
    pull_request = event_name == "pull_request"

    if job in {"tests", "lint", "contributor-check"}:
        return not _enabled(needs, "python")
    if job == "js-tests":
        return not _enabled(needs, "frontend")
    if job == "e2e-desktop":
        return not (_enabled(needs, "python") or _enabled(needs, "frontend"))
    if job == "studio-native":
        return not _enabled(needs, "studio_native")
    if job == "docs-site":
        return not _enabled(needs, "site")
    if job == "history-check":
        return not pull_request
    if job == "lockfile-diff":
        return not (pull_request and _enabled(needs, "npm_lock"))
    if job == "docker-lint":
        return not _enabled(needs, "docker_meta")
    if job == "supply-chain":
        return not (
            pull_request and (_enabled(needs, "scan") or _enabled(needs, "deps"))
        )
    if job == "review-labels":
        review_required = (
            _enabled(needs, "ci_review")
            or _enabled(needs, "mcp_catalog")
            or _output(needs, "supply-chain", "critical_findings") == "true"
        )
        return not (pull_request and review_required)
    return False


def evaluate(needs: dict[str, Any]) -> tuple[dict[str, str], list[str]]:
    """Return compact results and jobs that did not terminate acceptably."""
    compact: dict[str, str] = {}
    invalid: list[str] = []
    for name, raw_info in needs.items():
        info = raw_info if isinstance(raw_info, dict) else {}
        result = str(info.get("result", ""))
        compact[name] = result
        if result == "success":
            continue
        if result == "skipped" and expected_skip(name, needs):
            continue
        invalid.append(name)
    return compact, invalid


def main() -> int:
    try:
        needs = json.loads(os.environ.get("NEEDS", "{}"))
    except json.JSONDecodeError as error:
        print(f"::error::Invalid NEEDS JSON: {error}")
        return 1
    if not isinstance(needs, dict):
        print("::error::NEEDS must be a JSON object")
        return 1

    compact, invalid = evaluate(needs)
    payload = json.dumps(compact, separators=(",", ":"), sort_keys=True)
    print(f"needs-json={payload}")
    if destination := os.environ.get("GITHUB_OUTPUT"):
        with open(destination, "a", encoding="utf-8") as handle:
            handle.write(f"needs-json={payload}\n")

    for name in sorted(compact):
        result = compact[name]
        accepted = result == "success" or (
            result == "skipped" and expected_skip(name, needs)
        )
        print(f"{'✅' if accepted else '❌'} {name}: {result}")
    if invalid:
        print(
            f"::error::{len(invalid)} required job(s) did not pass: "
            + ", ".join(sorted(invalid))
        )
        return 1
    print("All required checks passed or were intentionally skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
