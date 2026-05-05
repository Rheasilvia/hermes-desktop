"""Integration test: sidecar binds loopback only and announces READY."""
from __future__ import annotations

import os
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
    token_file = home / "desktop" / "sidecar.token"
    token_file.write_text("integration-token")
    os.chmod(token_file, 0o600)
    return home


def test_sidecar_binds_loopback_only(tmp_path: Path) -> None:
    """Verify the sidecar prints READY <port>, accepts 127.0.0.1, and
    refuses connections on external interfaces."""
    home = _setup_home(tmp_path)
    env = {**os.environ, "HERMES_HOME": str(home)}
    proc = subprocess.Popen(
        [sys.executable, "-m", "desktop_backend"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        text=True,
    )
    try:
        deadline = time.time() + 5
        port = None
        while time.time() < deadline:
            line = proc.stdout.readline()
            if line.startswith("READY "):
                port = int(line.split()[1])
                break
        assert port is not None, "sidecar did not announce READY <port>"

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
