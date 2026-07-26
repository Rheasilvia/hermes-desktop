# daemon/__main__.py
"""Entry point. Binds 127.0.0.1:<port>, prints `READY <port>` on stdout."""
from __future__ import annotations

import logging
import os
import sys
import threading
import time

import uvicorn

try:
    from .app import build_app
    from .config import load_config
except ImportError:
    # PyInstaller one-file: __main__ has no package context
    from daemon.app import build_app  # type: ignore[no-redef]
    from daemon.config import load_config  # type: ignore[no-redef]


def _bound_port(server: uvicorn.Server) -> int:
    """Return the port from the socket Uvicorn actually bound."""
    for running_server in getattr(server, "servers", []):
        for sock in running_server.sockets or []:
            address = sock.getsockname()
            if isinstance(address, tuple) and len(address) >= 2:
                return int(address[1])
    raise RuntimeError("Uvicorn started without an inspectable TCP socket")


def _announce(server: uvicorn.Server) -> None:
    while not server.started:
        time.sleep(0.01)
    sys.stdout.write(f"READY {_bound_port(server)}\n")
    sys.stdout.flush()


def main() -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    cfg = load_config()
    app = build_app(cfg)
    config = uvicorn.Config(
        app=app,
        host=cfg.bind_host,
        port=cfg.port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)
    threading.Thread(target=_announce, args=(server,), daemon=True).start()
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
