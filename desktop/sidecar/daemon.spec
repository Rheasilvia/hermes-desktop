# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, is_module_or_submodule

block_cipher = None
ROOT = Path.cwd().parent.parent

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
    ["daemon/__main__.py"],
    pathex=[".", str(ROOT)],
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
    strip=True, upx=False, console=True,
)
