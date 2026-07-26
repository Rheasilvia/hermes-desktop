#!/usr/bin/env python3
"""Build, stage, and smoke-test the host-native Hermes Studio sidecar."""
from __future__ import annotations

import argparse
from collections import deque
import os
from pathlib import Path
import queue
import signal
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib.request import urlopen

import psutil

SIDECAR_ROOT = Path(__file__).resolve().parents[1]
if str(SIDECAR_ROOT) not in sys.path:
    sys.path.insert(0, str(SIDECAR_ROOT))

from build_support import BuildLayout, stage_executable  # noqa: E402


def _reader(stream, lines: queue.Queue[str]) -> None:
    for line in iter(stream.readline, ""):
        lines.put(line.rstrip("\r\n"))


def _tail_reader(stream, lines: deque[str]) -> None:
    for line in iter(stream.readline, ""):
        lines.append(line.rstrip("\r\n"))


def _mark_owned_process_group(process: subprocess.Popen) -> None:
    """Remember the exact POSIX group created for a smoke subprocess."""
    if os.name == "posix":
        # Every caller uses start_new_session=True, making the new PID the
        # process-group ID. Record it while ownership is unambiguous so cleanup
        # can still address same-group descendants after the leader exits.
        setattr(process, "_hermes_studio_owned_pgid", process.pid)


def _wait_process_group_exit(pgid: int, timeout: float) -> bool:
    """Wait for one previously recorded POSIX process group to disappear."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            os.killpg(pgid, 0)
        except ProcessLookupError:
            return True
        except (PermissionError, OSError):
            return False
        time.sleep(0.05)
    return False


def _terminate_process_tree(process: subprocess.Popen, timeout: float = 5.0) -> None:
    """Terminate only ``process`` and the descendants it created.

    Descendants are captured before the root is signalled so they remain
    addressable even if the root exits and the OS reparents them.  ``psutil``
    process identities include creation time, avoiding a process-name sweep or
    accidental termination after PID reuse.
    """
    owned_pgid = getattr(process, "_hermes_studio_owned_pgid", None)
    if owned_pgid is None and os.name == "posix" and process.poll() is None:
        try:
            candidate_pgid = os.getpgid(process.pid)
            if candidate_pgid == process.pid:
                owned_pgid = candidate_pgid
        except (OSError, ProcessLookupError):
            pass

    owned: list[psutil.Process] = []
    try:
        root = psutil.Process(process.pid)
        descendants = root.children(recursive=True)
        # Suspend the known tree before a second snapshot. This closes the
        # fork-between-snapshot-and-signal race without scanning by name.
        for owned_process in [root, *descendants]:
            try:
                owned_process.suspend()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        try:
            descendants = list({*descendants, *root.children(recursive=True)})
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
        owned = [*reversed(descendants), root]
    except (psutil.NoSuchProcess, psutil.AccessDenied, PermissionError):
        # POSIX group cleanup below remains available in restricted build
        # sandboxes where enumerating the process table is not permitted.
        owned = []

    if isinstance(owned_pgid, int) and os.name == "posix":
        try:
            os.killpg(owned_pgid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            pass

    for owned_process in owned:
        try:
            owned_process.terminate()
        except psutil.NoSuchProcess:
            pass

    _, alive = psutil.wait_procs(owned, timeout=timeout)
    if isinstance(owned_pgid, int) and os.name == "posix":
        if not _wait_process_group_exit(owned_pgid, timeout if not owned else 0.1):
            try:
                os.killpg(owned_pgid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass
    for owned_process in alive:
        try:
            owned_process.kill()
        except psutil.NoSuchProcess:
            pass
    if alive:
        psutil.wait_procs(alive, timeout=timeout)

    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        # The root may have disappeared between psutil's snapshot and the
        # signal.  Popen.kill still addresses only the exact child we spawned.
        process.kill()
        process.wait(timeout=timeout)


def _run_frozen_probe(
    executable: Path,
    args: list[str],
    *,
    timeout: float = 45.0,
) -> subprocess.CompletedProcess[str]:
    """Run one frozen entry-point probe with exact-tree timeout cleanup."""
    process = subprocess.Popen(
        [str(executable), *args],
        cwd=SIDECAR_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=(subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0),
        start_new_session=(os.name == "posix"),
    )
    _mark_owned_process_group(process)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        _terminate_process_tree(process)
        raise RuntimeError(
            f"frozen sidecar probe timed out for arguments {args!r}"
        ) from exc
    finally:
        if process.poll() is None:
            _terminate_process_tree(process)
    return subprocess.CompletedProcess(
        args=[str(executable), *args],
        returncode=int(process.returncode or 0),
        stdout=stdout,
        stderr=stderr,
    )


def _verify_frozen_entrypoints(executable: Path) -> None:
    """Prove the binary is an app entry point, never a Python surrogate."""
    rejected = _run_frozen_probe(executable, ["-m", "pip", "--version"])
    if rejected.returncode == 0 or "READY " in rejected.stdout:
        raise RuntimeError(
            "frozen sidecar accepted Python interpreter arguments or started "
            "the HTTP service"
        )
    if "does not accept Python interpreter arguments" not in rejected.stderr:
        raise RuntimeError(
            "frozen sidecar rejected interpreter arguments without the "
            "expected diagnostic"
        )

    if os.name == "posix":
        watchdog = _run_frozen_probe(
            executable,
            [
                "--hermes-mcp-stdio-watchdog",
                "--ppid",
                str(os.getpid()),
                "--parent-create-time",
                repr(psutil.Process(os.getpid()).create_time()),
                "--",
                sys.executable,
                "-c",
                "pass",
            ],
        )
        if watchdog.returncode != 0 or "READY " in watchdog.stdout:
            raise RuntimeError(
                "frozen sidecar MCP watchdog dispatch failed or started the "
                "HTTP service:\n" + watchdog.stderr
            )


def smoke_check(executable: Path, timeout: float = 90.0) -> int:
    """Start the staged binary on port zero and verify its health endpoint."""
    _verify_frozen_entrypoints(executable)
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
            start_new_session=(os.name == "posix"),
        )
        _mark_owned_process_group(process)
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
            _terminate_process_tree(process)


def build(*, smoke: bool = True) -> Path:
    layout = BuildLayout(SIDECAR_ROOT, sys.platform)
    subprocess.run(["uv", "sync", "--frozen", "--extra", "build"], cwd=SIDECAR_ROOT, check=True)
    shutil.rmtree(layout.pyinstaller_dist, ignore_errors=True)
    shutil.rmtree(layout.pyinstaller_work, ignore_errors=True)
    subprocess.run(layout.pyinstaller_command(), cwd=SIDECAR_ROOT, check=True)
    if not layout.built_executable.is_file():
        raise FileNotFoundError(f"PyInstaller output missing: {layout.built_executable}")
    stage_executable(layout)
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
