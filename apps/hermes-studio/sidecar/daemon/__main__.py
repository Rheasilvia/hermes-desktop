# daemon/__main__.py
"""Hermes Studio sidecar entry point.

The frozen executable is an application, not a general-purpose Python
interpreter.  In particular, ``sys.executable`` points back to this file under
PyInstaller, so accepting arbitrary arguments would turn an accidental
``daemon -m pip`` or ``daemon path/to/script.py`` spawn into another copy of
the HTTP service.  Only the no-argument server entry point and the one private
MCP watchdog action below are supported.
"""
from __future__ import annotations

import logging
import sys
import threading
import time
from typing import Any

_MCP_WATCHDOG_ACTION = "--hermes-mcp-stdio-watchdog"
_MCP_WATCHDOG_SYS_ATTR = "_hermes_mcp_watchdog_entrypoint"


def _bound_port(server: Any) -> int:
    """Return the port from the socket Uvicorn actually bound."""
    for running_server in getattr(server, "servers", []):
        for sock in running_server.sockets or []:
            address = sock.getsockname()
            if isinstance(address, tuple) and len(address) >= 2:
                return int(address[1])
    raise RuntimeError("Uvicorn started without an inspectable TCP socket")


def _announce(server: Any) -> None:
    while not server.started:
        time.sleep(0.01)
    sys.stdout.write(f"READY {_bound_port(server)}\n")
    sys.stdout.flush()


def _run_server() -> int:
    import uvicorn

    try:
        from .app import build_app
        from .config import load_config
    except ImportError:
        # PyInstaller one-file: __main__ has no package context.
        from daemon.app import build_app
        from daemon.config import load_config

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


def _run_frozen_watchdog(argv: list[str]) -> int:
    """Run the bundled stdio watchdog without pretending to be Python."""
    from tools.mcp_stdio_watchdog import main as watchdog_main

    return watchdog_main(argv)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    frozen = bool(getattr(sys, "frozen", False))

    if frozen:
        # tools.mcp_tool reads this process-local marker when it needs to
        # launch the bundled watchdog.  Other frozen Hermes entry points that
        # do not opt in safely skip the wrapper instead of assuming they can
        # execute arbitrary Python files.
        setattr(sys, _MCP_WATCHDOG_SYS_ATTR, _MCP_WATCHDOG_ACTION)

    if args:
        if frozen and args[0] == _MCP_WATCHDOG_ACTION:
            return _run_frozen_watchdog(args[1:])
        print(
            "Hermes Studio sidecar does not accept Python interpreter "
            f"arguments: {args[0]!r}",
            file=sys.stderr,
        )
        return 2

    return _run_server()


if __name__ == "__main__":
    raise SystemExit(main())
