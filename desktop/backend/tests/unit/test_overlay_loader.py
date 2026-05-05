import json
import re
from pathlib import Path

import pytest

from desktop_backend.overlays.loader import load, update


def overlay_dir(home: Path) -> Path:
    return home / "desktop" / "overlays"


def test_load_missing_returns_empty(tmp_path):
    assert load(tmp_path, "cron") == {}


def test_load_valid_returns_payload(tmp_path):
    d = overlay_dir(tmp_path)
    d.mkdir(parents=True)
    (d / "cron.json").write_text('{"job_test_001": {"pinned": true}}')
    assert load(tmp_path, "cron") == {"job_test_001": {"pinned": True}}


def test_load_corrupt_renames_and_returns_empty(tmp_path):
    d = overlay_dir(tmp_path)
    d.mkdir(parents=True)
    (d / "cron.json").write_text("not json")
    assert load(tmp_path, "cron") == {}
    backups = list(d.glob("cron.json.corrupt-*"))
    assert len(backups) == 1
    assert re.match(
        r"cron\.json\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z",
        backups[0].name,
    )


def test_update_creates_file(tmp_path):
    update(tmp_path, "cron", "job_test_001", {"pinned": True})
    payload = json.loads((overlay_dir(tmp_path) / "cron.json").read_text())
    assert payload["job_test_001"]["pinned"] is True


def test_update_merges_into_existing_entry(tmp_path):
    d = overlay_dir(tmp_path)
    d.mkdir(parents=True)
    (d / "cron.json").write_text(
        '{"job_test_001": {"pinned": true, "color": "red"}}'
    )
    update(tmp_path, "cron", "job_test_001", {"pinned": False})
    payload = json.loads((d / "cron.json").read_text())
    assert payload["job_test_001"] == {"pinned": False, "color": "red"}


def test_update_preserves_other_entities(tmp_path):
    d = overlay_dir(tmp_path)
    d.mkdir(parents=True)
    (d / "cron.json").write_text(
        '{"job_test_001": {"pinned": true}, "job_test_002": {"pinned": false}}'
    )
    update(tmp_path, "cron", "job_test_001", {"pinned": False})
    payload = json.loads((d / "cron.json").read_text())
    assert payload["job_test_002"] == {"pinned": False}
