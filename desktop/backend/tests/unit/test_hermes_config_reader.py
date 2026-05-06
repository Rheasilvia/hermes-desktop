from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from desktop_backend.readers.hermes_config import read_active_model


def test_reads_provider_and_model(tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        textwrap.dedent("""\
            model:
              provider: kimi-coding
              default: kimi-k2.6
        """)
    )
    result = read_active_model(tmp_path)
    assert result == {"provider": "kimi-coding", "model": "kimi-k2.6"}


def test_missing_file_returns_nulls(tmp_path: Path):
    result = read_active_model(tmp_path)
    assert result == {"provider": None, "model": None}


def test_missing_model_key_returns_nulls(tmp_path: Path):
    (tmp_path / "config.yaml").write_text("other_section:\n  foo: bar\n")
    result = read_active_model(tmp_path)
    assert result == {"provider": None, "model": None}


def test_malformed_yaml_returns_nulls(tmp_path: Path):
    (tmp_path / "config.yaml").write_text(": bad: yaml: :\n")
    result = read_active_model(tmp_path)
    assert result == {"provider": None, "model": None}


def test_partial_model_section(tmp_path: Path):
    (tmp_path / "config.yaml").write_text("model:\n  provider: anthropic\n")
    result = read_active_model(tmp_path)
    assert result == {"provider": "anthropic", "model": None}
