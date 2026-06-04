import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from daemon.app import build_app
from daemon.config import Config


FIXTURES = Path(__file__).parent.parent / "fixtures" / "hermes_home"


@pytest.fixture
def hermes_home(tmp_path: Path) -> Path:
    dest = tmp_path / ".hermes"
    shutil.copytree(FIXTURES, dest)
    (dest / "desktop").mkdir(parents=True, exist_ok=True)
    return dest


@pytest.fixture
def cfg(hermes_home: Path) -> Config:
    return Config(
        hermes_home=hermes_home,
        bind_host="127.0.0.1",
        token="test-token",
    )


@pytest.fixture
def client(cfg: Config) -> TestClient:
    return TestClient(build_app(cfg))


@pytest.fixture
def auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}
