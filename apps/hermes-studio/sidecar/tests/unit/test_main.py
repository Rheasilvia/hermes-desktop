from types import SimpleNamespace

import daemon.__main__ as daemon_main


class FakeSocket:
    def getsockname(self):
        return ("127.0.0.1", 43123)


def test_bound_port_comes_from_uvicorn_socket_not_requested_port():
    server = SimpleNamespace(
        servers=[SimpleNamespace(sockets=[FakeSocket()])],
    )

    assert daemon_main._bound_port(server) == 43123


def test_unknown_arguments_are_rejected_without_starting_server(monkeypatch, capsys):
    monkeypatch.setattr(
        daemon_main,
        "_run_server",
        lambda: (_ for _ in ()).throw(AssertionError("server must not start")),
    )

    assert daemon_main.main(["-m", "pip", "--version"]) == 2
    assert "does not accept Python interpreter arguments" in capsys.readouterr().err


def test_frozen_watchdog_action_dispatches_explicit_internal_mode(monkeypatch):
    captured: list[str] = []
    monkeypatch.setattr(daemon_main.sys, "frozen", True, raising=False)
    monkeypatch.setattr(
        daemon_main.sys,
        daemon_main._MCP_WATCHDOG_SYS_ATTR,
        "previous-entrypoint",
        raising=False,
    )
    monkeypatch.setattr(
        daemon_main,
        "_run_frozen_watchdog",
        lambda argv: captured.extend(argv) or 17,
    )

    result = daemon_main.main(
        [
            daemon_main._MCP_WATCHDOG_ACTION,
            "--ppid",
            "123",
            "--",
            "/usr/bin/server",
        ]
    )

    assert result == 17
    assert captured == ["--ppid", "123", "--", "/usr/bin/server"]
    assert (
        getattr(daemon_main.sys, daemon_main._MCP_WATCHDOG_SYS_ATTR)
        == daemon_main._MCP_WATCHDOG_ACTION
    )


def test_watchdog_action_is_private_to_frozen_build(monkeypatch):
    monkeypatch.delattr(daemon_main.sys, "frozen", raising=False)
    monkeypatch.setattr(
        daemon_main,
        "_run_frozen_watchdog",
        lambda argv: (_ for _ in ()).throw(AssertionError("watchdog must not run")),
    )

    assert daemon_main.main([daemon_main._MCP_WATCHDOG_ACTION]) == 2
