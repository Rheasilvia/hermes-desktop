from __future__ import annotations

from daemon.services.prompt_context import prepare_turn_context


class _Agent:
    model = "gpt-4.1"
    provider = "openai"
    base_url = ""
    api_key = ""
    _config_context_length = 200_000


def test_prepare_turn_context_expands_file_refs_against_workspace(tmp_path):
    workspace = tmp_path / "workspace"
    docs = workspace / "docs"
    docs.mkdir(parents=True)
    (docs / "mydoc.txt").write_text("hello from file", encoding="utf-8")

    prepared = prepare_turn_context(
        "@file:docs/mydoc.txt",
        cwd=str(workspace),
        agent=_Agent(),
    )

    assert prepared is not None
    assert "hello from file" in prepared
    assert "Attached Context" in prepared


def test_prepare_turn_context_expands_multiple_file_refs_and_line_ranges(tmp_path):
    workspace = tmp_path / "workspace"
    docs = workspace / "docs"
    src = workspace / "src"
    docs.mkdir(parents=True)
    src.mkdir(parents=True)
    (docs / "a.ts").write_text("a1\na2\na3\n", encoding="utf-8")
    (src / "b.ts").write_text("b1\nb2\n", encoding="utf-8")

    prepared = prepare_turn_context(
        "@file:docs/a.ts:1-2\n@file:src/b.ts",
        cwd=str(workspace),
        agent=_Agent(),
    )

    assert prepared is not None
    assert "Attached Context" in prepared
    assert "@file:docs/a.ts" in prepared
    assert "@file:src/b.ts" in prepared
    assert "a1" in prepared
    assert "a2" in prepared
    assert "a3" not in prepared
    assert "b1" in prepared
    assert "b2" in prepared
