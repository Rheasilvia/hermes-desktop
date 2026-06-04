"""Unit tests for overlays/loader.py — SQLite-based overlay loader (v3)."""

from pathlib import Path

import pytest

from daemon.overlays.loader import load, update, delete


@pytest.fixture
def hermes_home(tmp_path: Path) -> Path:
    home = tmp_path / ".hermes"
    (home / "desktop").mkdir(parents=True)
    return home


def test_load_missing_returns_empty(hermes_home: Path):
    assert load(hermes_home, "cron") == {}


def test_update_and_load_roundtrip(hermes_home: Path):
    update(hermes_home, "cron", "job_test_001", {"pinned": True})
    result = load(hermes_home, "cron")
    assert result["job_test_001"]["pinned"] == 1  # SQLite stores bool as int


def test_update_merges_into_existing_entry(hermes_home: Path):
    update(hermes_home, "cron", "job_test_001", {"pinned": True, "color": "red"})
    update(hermes_home, "cron", "job_test_001", {"pinned": False})
    result = load(hermes_home, "cron")
    assert result["job_test_001"] == {"pinned": False, "color": "red"}


def test_update_preserves_other_entities(hermes_home: Path):
    update(hermes_home, "cron", "job_test_001", {"pinned": True})
    update(hermes_home, "cron", "job_test_002", {"pinned": False})
    update(hermes_home, "cron", "job_test_001", {"pinned": False})
    result = load(hermes_home, "cron")
    assert result["job_test_002"]["pinned"] == 0  # SQLite stores bool as int


def test_delete_removes_entity(hermes_home: Path):
    update(hermes_home, "cron", "job_test_001", {"pinned": True})
    delete(hermes_home, "cron", "job_test_001")
    result = load(hermes_home, "cron")
    assert "job_test_001" not in result


def test_load_unknown_domain_returns_empty(hermes_home: Path):
    assert load(hermes_home, "unknown") == {}


def test_update_unknown_domain_raises(hermes_home: Path):
    with pytest.raises(ValueError, match="Unknown overlay domain"):
        update(hermes_home, "unknown", "x", {"a": 1})
