from __future__ import annotations

import asyncio
import inspect

import httpx
import pytest


def _patch_httpx_client_app_kwarg() -> None:
    """Allow Starlette's TestClient to run against httpx>=0.28.

    Starlette's TestClient in this environment still passes an ``app=`` kwarg
    to ``httpx.Client``. httpx 0.28 removed that parameter; the ASGI transport is
    already passed separately, so dropping the stale kwarg restores the test
    harness without pinning dependencies away from the repo root.
    """
    if "app" in inspect.signature(httpx.Client.__init__).parameters:
        return
    if getattr(httpx.Client.__init__, "_desktop_app_kwarg_compat", False):
        return
    original = httpx.Client.__init__

    def compat_init(self, *args, app=None, **kwargs):  # type: ignore[no-untyped-def]
        return original(self, *args, **kwargs)

    compat_init._desktop_app_kwarg_compat = True  # type: ignore[attr-defined]
    httpx.Client.__init__ = compat_init  # type: ignore[method-assign]


_patch_httpx_client_app_kwarg()


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "asyncio: run async test with asyncio.run")


def pytest_pyfunc_call(pyfuncitem: pytest.Function) -> bool | None:
    if pyfuncitem.get_closest_marker("asyncio") is None:
        return None
    if not inspect.iscoroutinefunction(pyfuncitem.obj):
        return None
    kwargs = {
        name: pyfuncitem.funcargs[name]
        for name in pyfuncitem._fixtureinfo.argnames
    }
    asyncio.run(pyfuncitem.obj(**kwargs))
    return True
