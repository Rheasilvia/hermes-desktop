from pathlib import Path

import pytest

from desktop_backend.readers.model_catalog import (
    L1CorruptError,
    get_providers,
    load_catalog,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "hermes_home"


def test_load_catalog_parses_fixture():
    catalog = load_catalog(FIXTURES)
    assert catalog["fetched_at"] == "2026-05-05T09:00:00Z"
    assert len(catalog["providers"]) == 2


def test_get_providers_returns_list():
    providers = get_providers(FIXTURES)
    assert {p["id"] for p in providers} == {
        "provider_test_anthropic",
        "provider_test_openai",
    }


def test_load_catalog_missing_returns_empty(tmp_path):
    assert load_catalog(tmp_path) == {"providers": [], "fetched_at": None}


def test_load_catalog_corrupt_raises(tmp_path):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "model_catalog.json").write_text("garbage")
    with pytest.raises(L1CorruptError):
        load_catalog(tmp_path)
