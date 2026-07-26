from pathlib import Path

import pytest

from build_support import BuildLayout, executable_name, stage_executable


def test_pyinstaller_keeps_windows_stdout_for_the_ready_protocol():
    spec = (Path(__file__).resolve().parents[2] / "daemon.spec").read_text()

    assert "console=True" in spec
    assert "console=not sys.platform.startswith" not in spec


def test_build_layout_stages_the_host_executable_for_electron_builder(tmp_path: Path):
    for platform, expected in (
        ("darwin", "daemon"),
        ("linux", "daemon"),
        ("win32", "daemon.exe"),
    ):
        layout = BuildLayout(tmp_path, platform)
        assert executable_name(platform) == expected
        assert layout.built_executable == tmp_path / "dist" / "pyinstaller" / expected
        assert layout.staged_executable == tmp_path / "dist" / "electron" / expected


def test_pyinstaller_command_uses_explicit_isolated_output_paths(tmp_path: Path):
    layout = BuildLayout(tmp_path, "linux")
    command = layout.pyinstaller_command()

    assert command[:6] == ["uv", "run", "--frozen", "python", "-m", "PyInstaller"]
    assert command[command.index("--distpath") + 1] == str(layout.pyinstaller_dist)
    assert command[command.index("--workpath") + 1] == str(layout.pyinstaller_work)
    assert command[-2:] == [str(tmp_path / "daemon.spec"), "--noconfirm"]


@pytest.mark.parametrize(
    ("platform", "current_name", "stale_name"),
    [("darwin", "daemon", "daemon.exe"), ("linux", "daemon", "daemon.exe"), ("win32", "daemon.exe", "daemon")],
)
def test_stage_executable_removes_stale_cross_platform_artifacts(
    tmp_path: Path,
    platform: str,
    current_name: str,
    stale_name: str,
):
    layout = BuildLayout(tmp_path, platform)
    layout.pyinstaller_dist.mkdir(parents=True)
    layout.built_executable.write_bytes(b"current-host")
    layout.electron_staging.mkdir(parents=True)
    (layout.electron_staging / stale_name).write_bytes(b"stale-host")
    (layout.electron_staging / "unrelated-stale-file").write_bytes(b"stale")

    staged = stage_executable(layout)

    assert staged.name == current_name
    assert staged.read_bytes() == b"current-host"
    assert {entry.name for entry in layout.electron_staging.iterdir()} == {current_name}
    if platform != "win32":
        assert staged.stat().st_mode & 0o111
