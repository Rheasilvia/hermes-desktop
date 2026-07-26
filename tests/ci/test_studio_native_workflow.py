"""Behavior contracts for the Hermes Studio host-native CI lane."""

from __future__ import annotations

import json
from pathlib import Path
import re

import yaml


ROOT = Path(__file__).resolve().parents[2]


def _load(relative_path: str) -> dict:
    # BaseLoader keeps the GitHub Actions `on` key as a string under YAML 1.1.
    return yaml.load((ROOT / relative_path).read_text(), Loader=yaml.BaseLoader)


def test_native_matrix_builds_only_on_matching_host_architectures():
    workflow = _load(".github/workflows/studio-native.yml")
    rows = workflow["jobs"]["native-package"]["strategy"]["matrix"]["include"]

    assert {
        (row["runner"], row["platform"], row["arch"], row["dist_script"])
        for row in rows
    } == {
        ("macos-15", "mac", "arm64", "dist:mac"),
        ("macos-15-intel", "mac", "x64", "dist:mac"),
        ("windows-2025", "win", "x64", "dist:win"),
        ("ubuntu-24.04", "linux", "x64", "dist:linux"),
    }


def test_native_lane_has_required_quality_packaging_and_unsigned_contracts():
    path = ROOT / ".github/workflows/studio-native.yml"
    source = path.read_text()
    workflow = _load(".github/workflows/studio-native.yml")
    job = workflow["jobs"]["native-package"]
    steps = job["steps"]
    commands = "\n".join(
        value
        for step in steps
        for value in (step.get("run", ""), step.get("with", {}).get("command", ""))
    )

    assert "workflow_call" in workflow["on"]
    assert workflow["permissions"] == {"contents": "read"}
    assert job["env"]["CSC_IDENTITY_AUTO_DISCOVERY"] == "false"
    assert "secrets." not in source

    for command in (
        "npm ci",
        "npm run lint --workspace @hermes/studio",
        "npm run typecheck --workspace @hermes/studio",
        "npm test --workspace @hermes/studio",
        "npm run build --workspace @hermes/studio",
        "uv sync --frozen --python 3.12",
        "uv run --frozen --python 3.12",
        "pytest -q",
        "npx playwright install --with-deps chromium",
        "npm run test:e2e",
        "npm run test:packaged",
    ):
        assert command in commands

    linux_setup = next(
        step["run"]
        for step in steps
        if step.get("name") == "Install Linux packaging and Electron dependencies"
    )
    assert "xvfb" in linux_setup
    assert "rpm" in linux_setup
    browser_e2e = next(step for step in steps if step.get("name") == "Run Studio browser E2E")
    assert browser_e2e["if"] == "runner.os == 'Linux'"
    installer_smokes = [
        step for step in steps if step.get("name", "").startswith("Install, smoke-test, and uninstall")
    ]
    assert {step["if"] for step in installer_smokes} == {
        "runner.os == 'macOS'",
        "runner.os == 'Windows'",
        "runner.os == 'Linux'",
    }
    assert all("test:packaged:existing -- --app-path" in step["run"] for step in installer_smokes)

    mac_smoke = next(step["run"] for step in installer_smokes if step["if"] == "runner.os == 'macOS'")
    assert "hdiutil attach" in mac_smoke
    assert "com.hermes-agent.studio" in mac_smoke
    assert "test ! -e \"$installed_app\"" in mac_smoke

    windows_smoke = next(
        step["run"] for step in installer_smokes if step["if"] == "runner.os == 'Windows'"
    )
    assert "-ArgumentList '/S', \"/D=$installRoot\"" in windows_smoke
    assert "VersionInfo.ProductName -ne 'Hermes Studio'" in windows_smoke
    assert "Get-StudioUninstallEntries" in windows_smoke
    assert "NSIS uninstaller" in windows_smoke
    assert "NSIS uninstall left the installation directory behind" in windows_smoke

    linux_smoke = next(
        step["run"] for step in installer_smokes if step["if"] == "runner.os == 'Linux'"
    )
    assert 'package_name" != "hermes-studio"' in linux_smoke
    assert "sudo apt-get install -y" in linux_smoke
    assert "sudo dpkg --purge" in linux_smoke
    assert 'test ! -e "$install_root"' in linux_smoke
    assert "[ ! -x \"${artifacts[0]}\" ]" in commands
    assert "Hermes-Studio-$version-linux-x64.tar" in commands

    upload = next(
        step for step in steps if step.get("name") == "Upload unsigned Studio installers"
    )
    assert upload["with"]["name"].startswith("hermes-studio-unsigned-")
    assert upload["with"]["if-no-files-found"] == "error"

    for step in steps:
        uses = step.get("uses")
        if not uses or uses.startswith("./"):
            continue
        assert re.search(r"@[0-9a-f]{40}$", uses), uses


def test_orchestrator_exposes_gates_and_aggregates_native_lane():
    action = _load(".github/actions/detect-changes/action.yml")
    ci = _load(".github/workflows/ci.yml")

    assert "studio_native" in action["outputs"]
    assert "studio_native" in ci["jobs"]["detect"]["outputs"]
    assert ci["jobs"]["studio-native"]["uses"] == (
        "./.github/workflows/studio-native.yml"
    )
    aggregate = ci["jobs"]["all-checks-pass"]
    assert "studio-native" in aggregate["needs"]
    assert aggregate["permissions"] == {"contents": "read"}
    assert any(
        step.get("run") == "python3 scripts/ci/evaluate_required_jobs.py"
        for step in aggregate["steps"]
    )


def test_native_workflow_commands_are_backed_by_studio_package_scripts():
    manifest = json.loads(
        (ROOT / "apps/hermes-studio/package.json").read_text(encoding="utf-8")
    )
    scripts = manifest["scripts"]
    assert manifest["name"] == "@hermes/studio"
    assert manifest["build"]["artifactName"] == (
        "Hermes-Studio-${version}-${os}-${arch}.${ext}"
    )
    assert manifest["build"]["mac"]["target"] == ["dmg"]
    assert manifest["build"]["win"]["target"] == ["nsis"]
    assert set(manifest["build"]["linux"]["target"]) == {"AppImage", "deb", "rpm"}

    for name in (
        "build",
        "lint",
        "lint:css-tokens",
        "typecheck",
        "test",
        "test:packaged",
        "test:packaged:existing",
        "dist:mac",
        "dist:win",
        "dist:linux",
    ):
        assert scripts.get(name), name

    assert "test:packaged:existing" in scripts["test:packaged"]
