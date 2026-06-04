# daemon/__main__.py
"""Entry point. Binds 127.0.0.1:<port>, prints `READY <port>` on stdout."""
from __future__ import annotations

import logging
import os
import sys
import threading

import uvicorn

try:
    from .app import build_app
    from .config import load_config
except ImportError:
    # PyInstaller one-file: __main__ has no package context
    from daemon.app import build_app  # type: ignore[no-redef]
    from daemon.config import load_config  # type: ignore[no-redef]


def _announce(server: uvicorn.Server, port: int) -> None:
    while not server.started:
        pass
    sys.stdout.write(f"READY {port}\n")
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
    threading.Thread(target=_announce, args=(server, cfg.port), daemon=True).start()
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
