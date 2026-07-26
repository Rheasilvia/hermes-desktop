from pathlib import Path

from build_support import BuildLayout, executable_name


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
