import json
import os
from pathlib import Path

import pytest

from desktop_backend.util.atomic_write import atomic_write_json


def test_atomic_write_creates_target(tmp_path):
    target = tmp_path / "out.json"
    atomic_write_json(target, {"a": 1})
    assert json.loads(target.read_text()) == {"a": 1}


def test_atomic_write_overwrites_existing(tmp_path):
    target = tmp_path / "out.json"
    target.write_text('{"old": true}')
    atomic_write_json(target, {"new": True})
    assert json.loads(target.read_text()) == {"new": True}


def test_atomic_write_uses_same_dir_tmp(tmp_path, monkeypatch):
    target = tmp_path / "out.json"
    captured = {}
    real_replace = os.replace

    def spy_replace(src, dst):
        captured["src"] = src
        captured["dst"] = dst
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", spy_replace)
    atomic_write_json(target, {"a": 1})
    assert Path(captured["src"]).parent == tmp_path
    assert Path(captured["dst"]) == target


def test_atomic_write_failure_leaves_original(tmp_path, monkeypatch):
    target = tmp_path / "out.json"
    target.write_text('{"keep": true}')

    def boom(*a, **kw):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        atomic_write_json(target, {"new": True})
    assert json.loads(target.read_text()) == {"keep": True}
