"""Pure cross-platform path and command helpers for the sidecar build."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shutil
import stat


def executable_name(platform: str) -> str:
    return "daemon.exe" if platform == "win32" else "daemon"


@dataclass(frozen=True)
class BuildLayout:
    sidecar_root: Path
    platform: str

    @property
    def pyinstaller_dist(self) -> Path:
        return self.sidecar_root / "dist" / "pyinstaller"

    @property
    def pyinstaller_work(self) -> Path:
        return self.sidecar_root / "build" / "pyinstaller"

    @property
    def built_executable(self) -> Path:
        return self.pyinstaller_dist / executable_name(self.platform)

    @property
    def staged_executable(self) -> Path:
        return self.electron_staging / executable_name(self.platform)

    @property
    def electron_staging(self) -> Path:
        return self.sidecar_root / "dist" / "electron"

    def pyinstaller_command(self) -> list[str]:
        return [
            "uv",
            "run",
            "--frozen",
            "python",
            "-m",
            "PyInstaller",
            "--distpath",
            str(self.pyinstaller_dist),
            "--workpath",
            str(self.pyinstaller_work),
            str(self.sidecar_root / "daemon.spec"),
            "--noconfirm",
        ]


def stage_executable(layout: BuildLayout) -> Path:
    """Replace staging atomically enough for a single host-native build.

    Clearing the directory prevents a prior build for another OS from leaving
    both ``daemon`` and ``daemon.exe`` for electron-builder to package.
    """
    if layout.electron_staging.exists():
        shutil.rmtree(layout.electron_staging)
    layout.electron_staging.mkdir(parents=True, exist_ok=True)
    shutil.copy2(layout.built_executable, layout.staged_executable)
    if layout.platform != "win32":
        mode = layout.staged_executable.stat().st_mode
        layout.staged_executable.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return layout.staged_executable
