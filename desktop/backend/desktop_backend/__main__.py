# desktop_backend/__main__.py
"""Entry point. Binds 127.0.0.1:0, prints `READY <port>` on stdout."""
from __future__ import annotations

import asyncio
import logging
import socket
import sys
import threading

import uvicorn

from .app import build_app
from .config import load_config


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _announce(server: uvicorn.Server, port: int) -> None:
    while not server.started:
        # spin briefly waiting for uvicorn startup
        pass
    sys.stdout.write(f"READY {port}\n")
    sys.stdout.flush()


def main() -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    cfg = load_config(require_token=True)
    app = build_app(cfg)
    port = _free_port()
    config = uvicorn.Config(
        app=app,
        host=cfg.bind_host,  # always 127.0.0.1
        port=port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)
    threading.Thread(target=_announce, args=(server, port), daemon=True).start()
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
