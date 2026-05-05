# tests/unit/test_cron_reader.py
import json
from pathlib import Path
from unittest.mock import patch, mock_open, MagicMock

import pytest

from desktop_backend.readers.cron_reader import (
    L1CorruptError,
    get_job,
    load_jobs,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "hermes_home"


def test_load_jobs_parses_fixture():
    jobs = load_jobs(FIXTURES)
    assert len(jobs) == 2
    assert jobs[0]["id"] == "job_test_001"
    assert jobs[0]["schedule"] == "0 9 * * *"


def test_load_jobs_returns_empty_when_missing(tmp_path):
    assert load_jobs(tmp_path) == []


def test_load_jobs_raises_l1_corrupt_on_invalid_json(tmp_path):
    cron_dir = tmp_path / "cron"
    cron_dir.mkdir()
    (cron_dir / "jobs.json").write_text("not-json{{{")
    with pytest.raises(L1CorruptError) as exc:
        load_jobs(tmp_path)
    assert exc.value.path.endswith("jobs.json")


def test_get_job_returns_none_for_unknown():
    assert get_job(FIXTURES, "missing") is None


def test_get_job_returns_match():
    job = get_job(FIXTURES, "job_test_002")
    assert job is not None
    assert job["enabled"] is False


def test_load_jobs_never_opens_for_write(tmp_path, monkeypatch):
    cron_dir = tmp_path / "cron"
    cron_dir.mkdir()
    (cron_dir / "jobs.json").write_text('{"jobs": []}')
    real_open = open
    calls = []

    def spy(path, mode="r", *a, **kw):
        calls.append(mode)
        return real_open(path, mode, *a, **kw)

    monkeypatch.setattr("builtins.open", spy)
    load_jobs(tmp_path)
    for mode in calls:
        assert "w" not in mode and "a" not in mode and "+" not in mode
