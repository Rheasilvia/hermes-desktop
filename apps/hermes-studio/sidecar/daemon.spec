# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path
import sys

from PyInstaller.utils.hooks import collect_submodules, is_module_or_submodule

block_cipher = None
SIDECAR_ROOT = Path(SPECPATH).resolve()
ROOT = SIDECAR_ROOT.parents[2]

hiddenimports = (
    collect_submodules("daemon")
    + collect_submodules("tools")
    + collect_submodules("uvicorn")
    + collect_submodules("fastapi")
    + collect_submodules("pydantic")
    + collect_submodules(
        "mcp",
        filter=lambda name: not is_module_or_submodule(name, "mcp.cli"),
    )
    + ["model_tools", "toolsets"]
)

a = Analysis(
    [str(SIDECAR_ROOT / "daemon" / "__main__.py")],
    pathex=[str(SIDECAR_ROOT), str(ROOT)],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "test", "unittest"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, a.binaries, a.zipfiles, a.datas,
    name="daemon",
    debug=False, bootloader_ignore_signals=False,
    strip=not sys.platform.startswith("win"),
    upx=False,
    # READY is a stdout protocol consumed through Electron's pipe. A Windows
    # noconsole executable sets sys.stdout/sys.stderr to None, so retain the
    # console subsystem and hide its window at spawn time with windowsHide.
    console=True,
)
