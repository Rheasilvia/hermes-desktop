"""Unit + integration tests for the memory module.

Covers:
- Service-layer path safety (whitelist, traversal, unknown workspace)
- Read cap, write cap, UTF-8 encoding enforcement
- Atomic write + parent mkdir
- Optimistic concurrency via If-Match
- Search line numbers and snippets
- Router HTTP shape, error mappings, 409 with current content body
- Project enumeration from sessions table
"""
from __future__ import annotations

import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from daemon.app import build_app
from daemon.config import Config
from daemon.services import memory_files as svc
from daemon.services.exceptions import (
    MemoryConcurrentWriteError,
    MemoryEncodingError,
    MemoryFileNotFoundError,
    MemoryFileTooLargeError,
    MemoryPathInvalidError,
)

AUTH = {"Authorization": "Bearer test-token"}


# ── Fixtures ─────────────────────────────────────────────────────────────


@pytest.fixture
def hermes_home(tmp_path) -> Path:
    home = tmp_path / "hermes"
    home.mkdir()
    return home


@pytest.fixture
def workspace(tmp_path) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    return ws


def _seed_sessions_db(hermes_home: Path, workspaces: list[str]) -> None:
    """Create state.db desktop sessions with the given cwd values."""
    from hermes_state import SessionDB

    db = SessionDB(hermes_home / "state.db")
    for i, ws in enumerate(workspaces):
        db.create_session(f"sess-{i}", "desktop", model="test", cwd=ws)


@pytest.fixture
def client(hermes_home, workspace) -> TestClient:
    cfg = Config(
        hermes_home=hermes_home,
        bind_host="127.0.0.1",
        token="test-token",
    )
    app = build_app(cfg)
    _seed_sessions_db(hermes_home, [str(workspace)])
    return TestClient(app)


# ── Service: resolve_safe_path ───────────────────────────────────────────


class TestResolveSafePath:
    def test_user_scope_resolves_under_hermes_home(self, hermes_home):
        p = svc.resolve_safe_path(
            "user",
            None,
            "AGENTS.md",
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        assert p == (hermes_home / "AGENTS.md").resolve()

    def test_project_scope_resolves_under_workspace(self, hermes_home, workspace):
        p = svc.resolve_safe_path(
            "project",
            str(workspace),
            "CLAUDE.md",
            hermes_home=hermes_home,
            known_workspaces=[str(workspace)],
        )
        assert p == (workspace / "CLAUDE.md").resolve()

    def test_rejects_non_whitelist_name(self, hermes_home):
        with pytest.raises(MemoryPathInvalidError):
            svc.resolve_safe_path(
                "user",
                None,
                "secrets.txt",
                hermes_home=hermes_home,
                known_workspaces=[],
            )

    def test_rejects_traversal_in_name(self, hermes_home):
        with pytest.raises(MemoryPathInvalidError):
            svc.resolve_safe_path(
                "user",
                None,
                "../../etc/passwd",
                hermes_home=hermes_home,
                known_workspaces=[],
            )

    def test_rejects_user_name_in_project_scope(self, hermes_home, workspace):
        with pytest.raises(MemoryPathInvalidError):
            svc.resolve_safe_path(
                "project",
                str(workspace),
                "memories/USER.md",
                hermes_home=hermes_home,
                known_workspaces=[str(workspace)],
            )

    def test_rejects_unknown_workspace(self, hermes_home):
        with pytest.raises(MemoryPathInvalidError):
            svc.resolve_safe_path(
                "project",
                "/nonexistent",
                "AGENTS.md",
                hermes_home=hermes_home,
                known_workspaces=[],
            )

    def test_rejects_project_scope_without_workspace(self, hermes_home):
        with pytest.raises(MemoryPathInvalidError):
            svc.resolve_safe_path(
                "project",
                None,
                "AGENTS.md",
                hermes_home=hermes_home,
                known_workspaces=[],
            )


# ── Service: list_files ──────────────────────────────────────────────────


class TestListFiles:
    def test_user_scope_returns_three_entries(self, hermes_home):
        files = svc.list_files(
            "user", None, hermes_home=hermes_home, known_workspaces=[]
        )
        assert {f.well_known_name for f in files} == {
            "AGENTS.md",
            "memories/MEMORY.md",
            "memories/USER.md",
        }
        assert all(not f.exists for f in files)
        assert all(f.scope == "user" for f in files)

    def test_project_scope_returns_four_entries(self, hermes_home, workspace):
        files = svc.list_files(
            "project",
            str(workspace),
            hermes_home=hermes_home,
            known_workspaces=[str(workspace)],
        )
        assert {f.well_known_name for f in files} == {
            "AGENTS.md",
            "CLAUDE.md",
            ".hermes/context.md",
            ".hermes/memories/MEMORY.md",
        }
        assert all(f.workspace_path == str(workspace) for f in files)

    def test_existing_file_marked_as_exists(self, hermes_home):
        (hermes_home / "AGENTS.md").write_text("hello", encoding="utf-8")
        files = svc.list_files(
            "user", None, hermes_home=hermes_home, known_workspaces=[]
        )
        agents = next(f for f in files if f.well_known_name == "AGENTS.md")
        assert agents.exists
        assert agents.size_bytes == 5
        assert agents.modified_at is not None


# ── Service: read_file ───────────────────────────────────────────────────


class TestReadFile:
    def test_reads_existing_file(self, hermes_home):
        (hermes_home / "AGENTS.md").write_text("hello world", encoding="utf-8")
        result = svc.read_file(
            "user",
            None,
            "AGENTS.md",
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        assert result.content == "hello world"
        assert result.info.exists

    def test_missing_file_raises(self, hermes_home):
        with pytest.raises(MemoryFileNotFoundError):
            svc.read_file(
                "user",
                None,
                "AGENTS.md",
                hermes_home=hermes_home,
                known_workspaces=[],
            )

    def test_oversize_file_raises(self, hermes_home, monkeypatch):
        monkeypatch.setattr(svc, "READ_CAP_BYTES", 10)
        (hermes_home / "AGENTS.md").write_text("x" * 100, encoding="utf-8")
        with pytest.raises(MemoryFileTooLargeError):
            svc.read_file(
                "user",
                None,
                "AGENTS.md",
                hermes_home=hermes_home,
                known_workspaces=[],
            )

    def test_non_utf8_raises_encoding_error(self, hermes_home):
        (hermes_home / "AGENTS.md").write_bytes(b"\xff\xfe\x00invalid utf8")
        with pytest.raises(MemoryEncodingError):
            svc.read_file(
                "user",
                None,
                "AGENTS.md",
                hermes_home=hermes_home,
                known_workspaces=[],
            )


# ── Service: write_file ──────────────────────────────────────────────────


class TestWriteFile:
    def test_creates_parent_directory(self, hermes_home):
        result = svc.write_file(
            "user",
            None,
            "memories/MEMORY.md",
            "first line",
            None,
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        assert (hermes_home / "memories" / "MEMORY.md").exists()
        assert result.content == "first line"
        assert result.info.exists

    def test_overwrites_without_if_match(self, hermes_home):
        (hermes_home / "AGENTS.md").write_text("old", encoding="utf-8")
        result = svc.write_file(
            "user",
            None,
            "AGENTS.md",
            "new",
            None,
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        assert result.content == "new"
        assert (hermes_home / "AGENTS.md").read_text() == "new"

    def test_oversize_write_raises(self, hermes_home, monkeypatch):
        monkeypatch.setattr(svc, "WRITE_CAP_BYTES", 5)
        with pytest.raises(MemoryFileTooLargeError):
            svc.write_file(
                "user",
                None,
                "AGENTS.md",
                "way too much",
                None,
                hermes_home=hermes_home,
                known_workspaces=[],
            )

    def test_unicode_content_round_trips(self, hermes_home):
        text = "你好,世界! 🚀"
        svc.write_file(
            "user",
            None,
            "memories/USER.md",
            text,
            None,
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        assert (hermes_home / "memories" / "USER.md").read_text(encoding="utf-8") == text


# ── Service: optimistic concurrency ──────────────────────────────────────


class TestConcurrency:
    def test_matching_if_match_succeeds(self, hermes_home):
        first = svc.write_file(
            "user",
            None,
            "AGENTS.md",
            "v1",
            None,
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        time.sleep(0.01)
        second = svc.write_file(
            "user",
            None,
            "AGENTS.md",
            "v2",
            first.info.modified_at,
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        assert second.content == "v2"

    def test_stale_if_match_raises_with_current(self, hermes_home):
        svc.write_file(
            "user",
            None,
            "AGENTS.md",
            "v1",
            None,
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        with pytest.raises(MemoryConcurrentWriteError) as excinfo:
            svc.write_file(
                "user",
                None,
                "AGENTS.md",
                "v2",
                "1970-01-01T00:00:00+00:00",
                hermes_home=hermes_home,
                known_workspaces=[],
            )
        assert excinfo.value.current is not None
        assert excinfo.value.current["content"] == "v1"
        assert excinfo.value.current["well_known_name"] == "AGENTS.md"


# ── Service: search ──────────────────────────────────────────────────────


class TestSearch:
    def test_finds_substring_with_line_number(self, hermes_home):
        (hermes_home / "AGENTS.md").write_text(
            "first line\nsecond Hermes line\nthird\n", encoding="utf-8"
        )
        hits = svc.search(
            "Hermes",
            "user",
            None,
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        assert len(hits) == 1
        assert hits[0].line_number == 2
        assert "Hermes" in hits[0].snippet

    def test_case_insensitive(self, hermes_home):
        (hermes_home / "AGENTS.md").write_text("HERMES rules", encoding="utf-8")
        hits = svc.search(
            "hermes",
            "user",
            None,
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        assert len(hits) == 1
        assert hits[0].match_count == 1

    def test_empty_query_returns_empty(self, hermes_home):
        (hermes_home / "AGENTS.md").write_text("anything", encoding="utf-8")
        hits = svc.search(
            "   ",
            "user",
            None,
            hermes_home=hermes_home,
            known_workspaces=[],
        )
        assert hits == []


# ── Service: list_projects ───────────────────────────────────────────────


class TestListProjects:
    def test_no_db_returns_empty(self, hermes_home):
        projects = svc.list_projects(hermes_home)
        assert projects == []

    def test_distinct_workspaces_ordered_by_recency(self, hermes_home):
        _seed_sessions_db(hermes_home, ["/proj/a", "/proj/b", "/proj/a"])
        projects = svc.list_projects(hermes_home)
        assert {p.workspace_path for p in projects} == {"/proj/a", "/proj/b"}
        # /proj/a was inserted first (newest last_opened_at).
        assert projects[0].workspace_path == "/proj/a"
        assert projects[0].session_count == 2


# ── Router: HTTP layer ───────────────────────────────────────────────────


class TestRouter:
    def test_projects_endpoint(self, client):
        r = client.get("/desktop/api/memory/projects", headers=AUTH)
        assert r.status_code == 200
        body = r.json()
        assert "projects" in body
        assert len(body["projects"]) == 1

    def test_files_user_scope(self, client):
        r = client.get(
            "/desktop/api/memory/files?scope=user", headers=AUTH
        )
        assert r.status_code == 200
        names = {f["well_known_name"] for f in r.json()["files"]}
        assert names == {"AGENTS.md", "memories/MEMORY.md", "memories/USER.md"}

    def test_files_project_scope_unknown_workspace_400(self, client):
        r = client.get(
            "/desktop/api/memory/files?scope=project&workspace=/nope",
            headers=AUTH,
        )
        assert r.status_code == 400
        assert r.json()["code"] == "MEMORY_PATH_INVALID"

    def test_read_missing_file_404(self, client):
        r = client.get(
            "/desktop/api/memory/file?scope=user&name=AGENTS.md",
            headers=AUTH,
        )
        assert r.status_code == 404
        assert r.json()["code"] == "MEMORY_FILE_NOT_FOUND"

    def test_write_then_read_round_trip(self, client):
        r = client.put(
            "/desktop/api/memory/file",
            json={"scope": "user", "name": "AGENTS.md", "content": "round trip"},
            headers=AUTH,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["content"] == "round trip"
        etag = r.headers["ETag"]
        assert etag == body["modified_at"]

        r2 = client.get(
            "/desktop/api/memory/file?scope=user&name=AGENTS.md", headers=AUTH
        )
        assert r2.status_code == 200
        assert r2.json()["content"] == "round trip"

    def test_invalid_name_pydantic_400(self, client):
        r = client.put(
            "/desktop/api/memory/file",
            json={"scope": "user", "name": "evil.txt", "content": "x"},
            headers=AUTH,
        )
        assert r.status_code == 400

    def test_concurrent_write_409_carries_current(self, client):
        client.put(
            "/desktop/api/memory/file",
            json={"scope": "user", "name": "AGENTS.md", "content": "v1"},
            headers=AUTH,
        )
        r = client.put(
            "/desktop/api/memory/file",
            json={"scope": "user", "name": "AGENTS.md", "content": "v2"},
            headers={**AUTH, "If-Match": "1970-01-01T00:00:00+00:00"},
        )
        assert r.status_code == 409
        body = r.json()
        assert body["code"] == "MEMORY_CONCURRENT_WRITE"
        assert body["current"]["content"] == "v1"

    def test_search_returns_line_number(self, client, hermes_home):
        (hermes_home / "AGENTS.md").write_text(
            "line one\nline two with Hermes\nline three\n", encoding="utf-8"
        )
        r = client.post(
            "/desktop/api/memory/search",
            json={"query": "Hermes"},
            headers=AUTH,
        )
        assert r.status_code == 200
        hits = r.json()["hits"]
        assert len(hits) == 1
        assert hits[0]["line_number"] == 2
