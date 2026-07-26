"""Pure cross-platform path and command helpers for the sidecar build."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


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
        return self.sidecar_root / "dist" / "electron" / executable_name(self.platform)

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
