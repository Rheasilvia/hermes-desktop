"""Integration test: sidecar binds loopback only and announces READY."""
from __future__ import annotations

import os
import select
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx
import pytest


def _setup_home(tmp_path: Path) -> Path:
    home = tmp_path / ".hermes"
    (home / "desktop").mkdir(parents=True)
    (home / "cron").mkdir()
    (home / "cache").mkdir()
    (home / "cron" / "jobs.json").write_text('{"jobs": []}')
    (home / "cache" / "model_catalog.json").write_text(
        '{"providers": [], "fetched_at": null}'
    )
    return home


def _free_loopback_port() -> int:
    sock = socket.socket()
    try:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])
    finally:
        sock.close()


def test_sidecar_binds_loopback_only(tmp_path: Path) -> None:
    """Verify the sidecar prints READY <port>, accepts 127.0.0.1, and
    refuses connections on external interfaces."""
    home = _setup_home(tmp_path)
    env = {
        **os.environ,
        "HERMES_HOME": str(home),
        "DESKTOP_BACKEND_TOKEN": "integration-token",
        "DESKTOP_BACKEND_PORT": str(_free_loopback_port()),
    }
    proc = subprocess.Popen(
        [sys.executable, "-m", "daemon"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True,
    )
    try:
        deadline = time.time() + 5
        port = None
        while time.time() < deadline:
            ready, _, _ = select.select([proc.stdout], [], [], 0.1)
            if not ready:
                if proc.poll() is not None:
                    break
                continue
            line = proc.stdout.readline()
            if line.startswith("READY "):
                port = int(line.split()[1])
                break
        if port is None:
            stderr = ""
            if proc.stderr is not None:
                ready_err, _, _ = select.select([proc.stderr], [], [], 0)
                if ready_err:
                    stderr = os.read(proc.stderr.fileno(), 4096).decode(errors="replace")
            raise AssertionError(f"sidecar did not announce READY <port>\n{stderr}")

        # Loopback works
        r = httpx.get(f"http://127.0.0.1:{port}/desktop/api/health", timeout=2)
        assert r.status_code == 200

        # External interface refuses connection
        host_ip = socket.gethostbyname(socket.gethostname())
        if host_ip != "127.0.0.1":
            with pytest.raises(httpx.ConnectError):
                httpx.get(f"http://{host_ip}:{port}/desktop/api/health", timeout=1)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
