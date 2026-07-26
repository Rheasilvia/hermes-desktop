#!/usr/bin/env python3
"""Build, stage, and smoke-test the host-native Hermes Studio sidecar."""
from __future__ import annotations

import argparse
from collections import deque
import os
from pathlib import Path
import queue
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import time
from urllib.request import urlopen

SIDECAR_ROOT = Path(__file__).resolve().parents[1]
if str(SIDECAR_ROOT) not in sys.path:
    sys.path.insert(0, str(SIDECAR_ROOT))

from build_support import BuildLayout  # noqa: E402


def _reader(stream, lines: queue.Queue[str]) -> None:
    for line in iter(stream.readline, ""):
        lines.put(line.rstrip("\r\n"))


def _tail_reader(stream, lines: deque[str]) -> None:
    for line in iter(stream.readline, ""):
        lines.append(line.rstrip("\r\n"))


def smoke_check(executable: Path, timeout: float = 90.0) -> int:
    """Start the staged binary on port zero and verify its health endpoint."""
    with tempfile.TemporaryDirectory(prefix="hermes-studio-sidecar-") as temporary:
        env = {
            **os.environ,
            "HERMES_HOME": str(Path(temporary) / ".hermes"),
            "DESKTOP_BACKEND_PORT": "0",
            "DESKTOP_BACKEND_TOKEN": "sidecar-smoke-token",
            "DESKTOP_WORKSPACE_GRANT_TOKEN": "sidecar-smoke-grant",
        }
        process = subprocess.Popen(
            [str(executable)],
            cwd=SIDECAR_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            creationflags=(subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0),
        )
        assert process.stdout is not None
        assert process.stderr is not None
        lines: queue.Queue[str] = queue.Queue()
        stderr_tail: deque[str] = deque(maxlen=200)
        threading.Thread(target=_reader, args=(process.stdout, lines), daemon=True).start()
        threading.Thread(target=_tail_reader, args=(process.stderr, stderr_tail), daemon=True).start()
        deadline = time.monotonic() + timeout
        port: int | None = None
        try:
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(
                        "sidecar exited before READY:\n" + "\n".join(stderr_tail)
                    )
                try:
                    line = lines.get(timeout=0.1)
                except queue.Empty:
                    continue
                if line.startswith("READY "):
                    port = int(line.removeprefix("READY ").strip())
                    break
            if not port:
                raise RuntimeError("sidecar smoke check timed out waiting for READY")
            with urlopen(f"http://127.0.0.1:{port}/desktop/api/health", timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError(f"sidecar health returned HTTP {response.status}")
            return port
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def build(*, smoke: bool = True) -> Path:
    layout = BuildLayout(SIDECAR_ROOT, sys.platform)
    subprocess.run(["uv", "sync", "--frozen", "--extra", "build"], cwd=SIDECAR_ROOT, check=True)
    shutil.rmtree(layout.pyinstaller_dist, ignore_errors=True)
    shutil.rmtree(layout.pyinstaller_work, ignore_errors=True)
    subprocess.run(layout.pyinstaller_command(), cwd=SIDECAR_ROOT, check=True)
    if not layout.built_executable.is_file():
        raise FileNotFoundError(f"PyInstaller output missing: {layout.built_executable}")
    layout.staged_executable.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(layout.built_executable, layout.staged_executable)
    if sys.platform != "win32":
        mode = layout.staged_executable.stat().st_mode
        layout.staged_executable.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    if smoke:
        port = smoke_check(layout.staged_executable)
        print(f"Smoke check passed on 127.0.0.1:{port}")
    print(f"Staged host-native sidecar: {layout.staged_executable}")
    return layout.staged_executable


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-smoke", action="store_true", help="skip the executable health smoke test")
    args = parser.parse_args()
    build(smoke=not args.no_smoke)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
