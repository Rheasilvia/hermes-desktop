"""Cross-language schema parity test.

Asserts that every field name in the Pydantic memory models (Python) is
present in the matching TypeScript interface in
``desktop/src/types/memory.ts``, and vice versa.

Structural guard: catches the case where one side gains or renames a field
without the other being updated. Does not check type compatibility — only
field names.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import BaseModel

from daemon.schemas.memory import (
    MemoryFileInfo,
    MemoryFileWithContent,
    MemoryProject,
    MemorySearchHit,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TS_TYPES = REPO_ROOT / "desktop" / "src" / "types" / "memory.ts"


def _read_ts() -> str:
    assert TS_TYPES.exists(), f"missing {TS_TYPES}"
    return TS_TYPES.read_text(encoding="utf-8")


def _ts_interface_fields(text: str, name: str) -> set[str]:
    """Extract member field names from `export interface <name> { ... }`."""
    pattern = re.compile(
        rf"export\s+interface\s+{re.escape(name)}(?:\s+extends\s+[^{{]+)?\s*{{([^}}]*)}}",
        re.DOTALL,
    )
    m = pattern.search(text)
    assert m, f"interface {name} not found in {TS_TYPES}"
    body = m.group(1)
    fields: set[str] = set()
    for raw in body.splitlines():
        line = raw.strip()
        if not line or line.startswith("//") or line.startswith("/*") or line.startswith("*"):
            continue
        fm = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\??\s*:", line)
        if fm:
            fields.add(fm.group(1))
    return fields


def _py_fields(model: type[BaseModel]) -> set[str]:
    return set(model.model_fields.keys())


@pytest.fixture(scope="module")
def ts_text() -> str:
    return _read_ts()


def test_memory_file_parity(ts_text: str) -> None:
    py = _py_fields(MemoryFileInfo)
    ts = _ts_interface_fields(ts_text, "MemoryFile")
    assert py == ts, (
        f"MemoryFileInfo (py) != MemoryFile (ts).\n"
        f"py only: {sorted(py - ts)}\nts only: {sorted(ts - py)}"
    )


def test_memory_file_with_content_parity(ts_text: str) -> None:
    py = _py_fields(MemoryFileWithContent)
    own = _ts_interface_fields(ts_text, "MemoryFileWithContent")
    inherited = _ts_interface_fields(ts_text, "MemoryFile")
    ts = own | inherited
    assert py == ts, (
        f"MemoryFileWithContent parity broken.\n"
        f"py only: {sorted(py - ts)}\nts only: {sorted(ts - py)}"
    )


def test_memory_project_parity(ts_text: str) -> None:
    py = _py_fields(MemoryProject)
    ts = _ts_interface_fields(ts_text, "MemoryProject")
    assert py == ts, (
        f"MemoryProject parity broken.\n"
        f"py only: {sorted(py - ts)}\nts only: {sorted(ts - py)}"
    )


def test_memory_search_hit_parity(ts_text: str) -> None:
    py = _py_fields(MemorySearchHit)
    ts = _ts_interface_fields(ts_text, "MemorySearchHit")
    assert py == ts, (
        f"MemorySearchHit parity broken.\n"
        f"py only: {sorted(py - ts)}\nts only: {sorted(ts - py)}"
    )
