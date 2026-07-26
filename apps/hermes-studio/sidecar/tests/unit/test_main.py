from types import SimpleNamespace

from daemon.__main__ import _bound_port


class FakeSocket:
    def getsockname(self):
        return ("127.0.0.1", 43123)


def test_bound_port_comes_from_uvicorn_socket_not_requested_port():
    server = SimpleNamespace(
        servers=[SimpleNamespace(sockets=[FakeSocket()])],
    )

    assert _bound_port(server) == 43123
