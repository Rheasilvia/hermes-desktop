import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from daemon.app import build_app
from daemon.config import Config
from daemon.readers import model_catalog
from daemon.services.model_service import ModelService


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
        workspace_grant_token="workspace-grant",
    )


@pytest.fixture
def client(cfg: Config) -> TestClient:
    app = build_app(cfg)

    def _fixture_models_payload() -> dict:
        providers = []
        for provider in model_catalog.get_providers(cfg.hermes_home):
            models = [
                model.get("id") if isinstance(model, dict) else str(model)
                for model in provider.get("models", [])
            ]
            providers.append({
                "slug": provider.get("id"),
                "name": provider.get("name"),
                "auth_type": provider.get("auth"),
                "authenticated": False,
                "models": models,
            })
        return {"providers": providers}

    app.state.model_svc = ModelService(
        cfg.hermes_home,
        event_bus=app.state.event_bus,
        models_payload_loader=_fixture_models_payload,
    )
    return TestClient(app)


@pytest.fixture
def auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


@pytest.fixture
def workspace_grant(auth: dict[str, str]) -> dict[str, str]:
    return {**auth, "X-Desktop-Workspace-Grant": "workspace-grant"}
