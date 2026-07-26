"""Tests for strict CI aggregate result evaluation."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


PATH = Path(__file__).resolve().parents[2] / "scripts" / "ci" / "evaluate_required_jobs.py"
SPEC = importlib.util.spec_from_file_location("evaluate_required_jobs", PATH)
if SPEC is None or SPEC.loader is None:
    raise ImportError("Failed to load evaluate_required_jobs.py")
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
evaluate = MODULE.evaluate


def _needs(
    *,
    event_name: str = "pull_request",
    enabled: tuple[str, ...] = (),
) -> dict:
    outputs = {
        "event_name": event_name,
        "python": "false",
        "frontend": "false",
        "studio_native": "false",
        "site": "false",
        "npm_lock": "false",
        "docker_meta": "false",
        "scan": "false",
        "deps": "false",
        "ci_review": "false",
        "mcp_catalog": "false",
    }
    outputs.update({name: "true" for name in enabled})
    return {
        "detect": {"result": "success", "outputs": outputs},
        "tests": {"result": "skipped", "outputs": {}},
        "lint": {"result": "skipped", "outputs": {}},
        "js-tests": {"result": "skipped", "outputs": {}},
        "e2e-desktop": {"result": "skipped", "outputs": {}},
        "studio-native": {"result": "skipped", "outputs": {}},
        "docs-site": {"result": "skipped", "outputs": {}},
        "history-check": {
            "result": "success" if event_name == "pull_request" else "skipped",
            "outputs": {},
        },
        "contributor-check": {"result": "skipped", "outputs": {}},
        "uv-lockfile": {"result": "success", "outputs": {}},
        "lockfile-diff": {"result": "skipped", "outputs": {}},
        "docker-lint": {"result": "skipped", "outputs": {}},
        "supply-chain": {
            "result": "skipped",
            "outputs": {"critical_findings": "false"},
        },
        "review-labels": {"result": "skipped", "outputs": {}},
        "osv-scanner": {"result": "success", "outputs": {}},
    }


def test_accepts_success_and_only_conditionally_expected_skips():
    needs = _needs()

    _, invalid = evaluate(needs)

    assert invalid == []


def test_requires_enabled_conditional_jobs_to_succeed():
    needs = _needs(enabled=("frontend", "studio_native"))

    _, invalid = evaluate(needs)

    assert invalid == ["js-tests", "e2e-desktop", "studio-native"]


@pytest.mark.parametrize(
    "result",
    ["failure", "cancelled", "timed_out", "action_required", "neutral", ""],
)
def test_rejects_every_non_success_terminal_result(result: str):
    needs = _needs()
    needs["uv-lockfile"]["result"] = result

    _, invalid = evaluate(needs)

    assert invalid == ["uv-lockfile"]


@pytest.mark.parametrize(
    "result",
    ["failure", "cancelled", "timed_out", "action_required", "neutral", ""],
)
def test_disabled_conditional_job_accepts_only_skipped(result: str):
    needs = _needs()
    needs["studio-native"]["result"] = result

    _, invalid = evaluate(needs)

    assert invalid == ["studio-native"]


def test_rejects_unexpected_skip_for_an_unconditional_job():
    needs = _needs()
    needs["osv-scanner"]["result"] = "skipped"

    _, invalid = evaluate(needs)

    assert invalid == ["osv-scanner"]


def test_review_gate_skip_depends_on_review_inputs_and_supply_chain_output():
    needs = _needs(enabled=("ci_review",))
    _, invalid = evaluate(needs)
    assert invalid == ["review-labels"]

    needs = _needs()
    needs["supply-chain"]["outputs"]["critical_findings"] = "true"
    _, invalid = evaluate(needs)
    assert invalid == ["review-labels"]


def test_push_allows_only_pr_specific_jobs_to_skip():
    needs = _needs(
        event_name="push",
        enabled=(
            "python",
            "frontend",
            "studio_native",
            "site",
            "npm_lock",
            "docker_meta",
            "scan",
            "deps",
            "ci_review",
        ),
    )
    for job in (
        "tests",
        "lint",
        "js-tests",
        "e2e-desktop",
        "studio-native",
        "docs-site",
        "contributor-check",
        "docker-lint",
    ):
        needs[job]["result"] = "success"

    _, invalid = evaluate(needs)

    assert invalid == []
