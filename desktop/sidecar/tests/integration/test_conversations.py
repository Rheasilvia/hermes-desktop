"""Integration tests for conversation endpoints.

Tests:
  - Happy path: POST /sessions → POST /prompt/execute → GET /sessions/{sid}/messages
  - Interrupt path: POST /sessions/{sid}/interrupt during a turn
  - Error path: prompt/execute with a non-existent session
  - Idempotent replay: GET /sessions/{sid}/messages?since=N
  - SSE event stream endpoint returns an event-stream response
"""
from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from daemon.app import build_app
from daemon.config import Config
from daemon.routers.events import _replay_pending_user_inputs, event_stream
from daemon.services import session_service


@pytest.fixture
def client(tmp_path):
    """TestClient with isolated hermes_home."""
    home = tmp_path / ".hermes"
    home.mkdir(parents=True)
    # Write a minimal config.yaml so _resolve_default_model has a fallback
    config_yaml = home / "config.yaml"
    config_yaml.write_text("model:\n  provider: openai\n  default: gpt-4\n")
    cfg = Config(hermes_home=home, port=18080, token=None, workspace_grant_token="workspace-grant")
    app = build_app(cfg)
    return TestClient(app)


class TestSessionCRUD:
    """Session create, list, get, rename, delete."""

    def test_create_session_returns_id(self, client):
        resp = client.post("/desktop/api/sessions", json={})
        assert resp.status_code == 200
        data = resp.json()
        assert "session_id" in data
        assert data["session_id"].startswith("desktop_")
        assert data["permissionMode"] == "auto"
        assert data["runtime"]["reasoningEffort"] == "medium"
        assert data["runtime"]["collaborationMode"] == "default"

    def test_create_session_without_workspace_creates_default_workspace(
        self, client, monkeypatch, tmp_path
    ):
        default_workspace = tmp_path / "HermesAgentWorkspace"
        monkeypatch.setattr(session_service, "DEFAULT_WORKSPACE", default_workspace)

        resp = client.post("/desktop/api/sessions", json={})

        assert resp.status_code == 200
        data = resp.json()
        assert data["cwd"] == str(default_workspace)
        assert default_workspace.is_dir()

    def test_create_session_with_model(self, client, tmp_path):
        cwd = tmp_path / "test"
        cwd.mkdir()
        resp = client.post("/desktop/api/sessions", json={
            "model": "anthropic/claude-opus-4.5",
            "cwd": str(cwd),
        }, headers={"X-Desktop-Workspace-Grant": "workspace-grant"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["model"] == "anthropic/claude-opus-4.5"
        assert data["cwd"] == str(cwd)

    def test_create_session_with_cwd_requires_workspace_grant(self, client, tmp_path):
        cwd = tmp_path / "test"
        cwd.mkdir()

        resp = client.post("/desktop/api/sessions", json={"cwd": str(cwd)})

        assert resp.status_code == 403
        assert resp.json()["detail"] == "WORKSPACE_GRANT_REQUIRED"

    def test_create_session_with_cwd_accepts_workspace_grant(self, client, tmp_path):
        cwd = tmp_path / "test"
        cwd.mkdir()

        resp = client.post(
            "/desktop/api/sessions",
            json={"cwd": str(cwd)},
            headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
        )

        assert resp.status_code == 200
        assert resp.json()["cwd"] == str(cwd)

    def test_create_session_preserves_explicit_workspace(
        self, client, monkeypatch, tmp_path
    ):
        default_workspace = tmp_path / "HermesAgentWorkspace"
        explicit_workspace = tmp_path / "project"
        explicit_workspace.mkdir()
        monkeypatch.setattr(session_service, "DEFAULT_WORKSPACE", default_workspace)

        resp = client.post(
            "/desktop/api/sessions",
            json={"cwd": str(explicit_workspace)},
            headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["cwd"] == str(explicit_workspace)
        assert "workspace_path" not in data

    def test_update_session_cwd_uses_state_db_field(self, client, tmp_path):
        first_cwd = tmp_path / "first"
        next_cwd = tmp_path / "next"
        first_cwd.mkdir()
        next_cwd.mkdir()
        r = client.post(
            "/desktop/api/sessions",
            json={"cwd": str(first_cwd)},
            headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
        )
        sid = r.json()["session_id"]

        from daemon.services.agent_pool import AgentPool

        class _FakeAgent:
            pass

        with patch.object(AgentPool, "_build_agent", return_value=(_FakeAgent(), "gpt-4", "openai")):
            client.app.state.agent_pool.get_or_create(sid)
        assert client.app.state.agent_pool.get_pooled_entry(sid) is not None

        resp = client.patch(
            f"/desktop/api/sessions/{sid}",
            json={"cwd": str(next_cwd)},
        )

        assert resp.status_code == 403
        assert resp.json()["detail"] == "WORKSPACE_GRANT_REQUIRED"
        assert client.app.state.agent_pool.get_pooled_entry(sid) is not None

        resp = client.patch(
            f"/desktop/api/sessions/{sid}",
            json={"cwd": str(next_cwd)},
            headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
        )

        assert resp.status_code == 200
        assert resp.json()["cwd"] == str(next_cwd)
        assert client.app.state.agent_pool.get_pooled_entry(sid) is None
        session = client.get(f"/desktop/api/sessions/{sid}").json()
        assert session["cwd"] == str(next_cwd)
        assert "workspace_path" not in session

    def test_update_session_cwd_rejects_missing_directory_without_mutating_db(self, client, tmp_path):
        first_cwd = tmp_path / "first"
        first_cwd.mkdir()
        missing_cwd = tmp_path / "missing"
        r = client.post(
            "/desktop/api/sessions",
            json={"cwd": str(first_cwd)},
            headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
        )
        sid = r.json()["session_id"]

        resp = client.patch(
            f"/desktop/api/sessions/{sid}",
            json={"cwd": str(missing_cwd)},
            headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
        )

        assert resp.status_code == 400
        session = client.get(f"/desktop/api/sessions/{sid}").json()
        assert session["cwd"] == str(first_cwd)

    def test_update_session_cwd_rejects_running_session_without_mutating_db(self, client, tmp_path):
        first_cwd = tmp_path / "first"
        next_cwd = tmp_path / "next"
        first_cwd.mkdir()
        next_cwd.mkdir()
        r = client.post(
            "/desktop/api/sessions",
            json={"cwd": str(first_cwd)},
            headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
        )
        sid = r.json()["session_id"]

        from daemon.services.agent_pool import AgentPool

        class _BlockingAgent:
            _interrupted = False

            def interrupt(self):
                self._interrupted = True

            def run_conversation(self, user_message, conversation_history):
                while not self._interrupted:
                    time.sleep(0.05)
                return "interrupted"

        with patch.object(AgentPool, "_build_agent", return_value=(_BlockingAgent(), "gpt-4", "openai")):
            try:
                run_resp = client.post("/desktop/api/prompt/execute", json={
                    "message": "first",
                    "session_id": sid,
                })
                assert run_resp.status_code == 202
                time.sleep(0.1)

                resp = client.patch(
                    f"/desktop/api/sessions/{sid}",
                    json={"cwd": str(next_cwd)},
                    headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
                )

                assert resp.status_code == 409
                assert resp.json()["code"] == "SESSION_BUSY"
                session = client.get(f"/desktop/api/sessions/{sid}").json()
                assert session["cwd"] == str(first_cwd)
            finally:
                client.post(f"/desktop/api/sessions/{sid}/interrupt")
                time.sleep(0.1)

    def test_image_attach_requires_path_under_session_cwd(self, client, tmp_path, monkeypatch):
        from daemon.services import session_service

        cwd = tmp_path / "project"
        outside = tmp_path / "outside"
        clipboard_tmp = tmp_path / "clipboard"
        cwd.mkdir()
        outside.mkdir()
        clipboard_tmp.mkdir()
        monkeypatch.setattr(session_service.tempfile, "gettempdir", lambda: str(clipboard_tmp))
        inside_image = cwd / "in.png"
        outside_image = outside / "out.png"
        inside_image.write_bytes(b"png")
        outside_image.write_bytes(b"png")
        r = client.post(
            "/desktop/api/sessions",
            json={"cwd": str(cwd)},
            headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
        )
        sid = r.json()["session_id"]

        ok = client.post("/desktop/api/image/attach", json={"session_id": sid, "path": str(inside_image)})
        denied = client.post("/desktop/api/image/attach", json={"session_id": sid, "path": str(outside_image)})

        assert ok.status_code == 200
        assert ok.json()["count"] == 1
        assert denied.status_code == 400

    def test_create_session_reuses_empty_untitled_session_from_db(self, client):
        first = client.post("/desktop/api/sessions", json={})
        assert first.status_code == 200
        first_data = first.json()

        second = client.post("/desktop/api/sessions", json={})

        assert second.status_code == 200
        second_data = second.json()
        assert second_data["id"] == first_data["id"]
        assert second_data["reused"] is True

        listed = client.get("/desktop/api/sessions")
        assert listed.status_code == 200
        ids = [s["id"] for s in listed.json()]
        assert ids.count(first_data["id"]) == 1

    def test_empty_session_reuse_refreshes_permission_mode_from_recent_conversation(self, client):
        reusable = client.post("/desktop/api/sessions", json={})
        assert reusable.status_code == 200
        reusable_id = reusable.json()["id"]

        # Make the reusable empty session stale enough that it is not the recent
        # non-empty conversation whose mode should seed the next new draft.
        client.post(
            "/desktop/api/sessions",
            json={"cwd": reusable.json()["cwd"]},
            headers={"X-Desktop-Workspace-Grant": "workspace-grant"},
        )
        from daemon.db.ui_messages import append
        append(client.app.state.cfg.hermes_home, reusable_id, "user", {"text": "old"})

        recent = client.post("/desktop/api/sessions", json={})
        assert recent.status_code == 200
        recent_id = recent.json()["id"]
        mode_resp = client.put(
            f"/desktop/api/sessions/{recent_id}/permission-mode",
            json={"mode": "full"},
        )
        assert mode_resp.status_code == 200
        append(client.app.state.cfg.hermes_home, recent_id, "user", {"text": "recent"})

        empty = client.post("/desktop/api/sessions", json={})
        assert empty.status_code == 200
        empty_id = empty.json()["id"]
        set_resp = client.put(
            f"/desktop/api/sessions/{empty_id}/permission-mode",
            json={"mode": "ask"},
        )
        assert set_resp.status_code == 200

        reused = client.post("/desktop/api/sessions", json={})

        assert reused.status_code == 200
        assert reused.json()["id"] == empty_id
        assert reused.json()["reused"] is True
        assert reused.json()["permissionMode"] == "full"

    def test_session_responses_include_permission_mode_and_set_returns_summary(self, client):
        created = client.post("/desktop/api/sessions", json={})
        sid = created.json()["id"]

        resp = client.put(
            f"/desktop/api/sessions/{sid}/permission-mode",
            json={"mode": "ask"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == sid
        assert data["permissionMode"] == "ask"
        assert data["appliedToActiveTurn"] is True
        assert data["appliesNextTurn"] is False
        assert client.get(f"/desktop/api/sessions/{sid}").json()["permissionMode"] == "ask"
        assert client.get("/desktop/api/sessions").json()[0]["permissionMode"] == "ask"

    def test_session_runtime_patch_persists_and_returns_normalized_summary(self, client):
        created = client.post("/desktop/api/sessions", json={})
        sid = created.json()["id"]

        resp = client.patch(
            f"/desktop/api/sessions/{sid}/runtime",
            json={"reasoningEffort": "high"},
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data == {
            "id": sid,
            "runtime": {"reasoningEffort": "high", "collaborationMode": "default"},
            "appliedToActiveTurn": True,
            "appliesNextTurn": False,
        }
        assert client.get(f"/desktop/api/sessions/{sid}").json()["runtime"] == {
            "reasoningEffort": "high",
            "collaborationMode": "default",
        }
        assert client.get("/desktop/api/sessions").json()[0]["runtime"] == {
            "reasoningEffort": "high",
            "collaborationMode": "default",
        }

        plan_resp = client.patch(
            f"/desktop/api/sessions/{sid}/runtime",
            json={"collaborationMode": "plan"},
        )

        assert plan_resp.status_code == 200
        assert plan_resp.json()["runtime"] == {
            "reasoningEffort": "high",
            "collaborationMode": "plan",
        }

    def test_session_runtime_patch_rejects_empty_and_invalid_values(self, client):
        created = client.post("/desktop/api/sessions", json={})
        sid = created.json()["id"]

        empty = client.patch(f"/desktop/api/sessions/{sid}/runtime", json={})
        invalid = client.patch(
            f"/desktop/api/sessions/{sid}/runtime",
            json={"reasoningEffort": "turbo"},
        )

        assert empty.status_code == 422
        assert invalid.status_code == 422
        assert client.get(f"/desktop/api/sessions/{sid}").json()["runtime"] == {
            "reasoningEffort": "medium",
            "collaborationMode": "default",
        }

    def test_session_runtime_patch_returns_404_for_unknown_session(self, client):
        resp = client.patch(
            "/desktop/api/sessions/desktop_missing/runtime",
            json={"reasoningEffort": "low"},
        )

        assert resp.status_code == 404
        assert resp.json()["detail"] == "SESSION_NOT_FOUND"

    def test_branch_session_copies_runtime(self, client):
        created = client.post("/desktop/api/sessions", json={})
        sid = created.json()["id"]
        client.patch(
            f"/desktop/api/sessions/{sid}/runtime",
            json={"reasoningEffort": "xhigh", "collaborationMode": "plan"},
        )

        branched = client.post(f"/desktop/api/sessions/{sid}/branch")

        assert branched.status_code == 200
        assert branched.json()["runtime"] == {
            "reasoningEffort": "xhigh",
            "collaborationMode": "plan",
        }

    def test_session_runtime_patch_does_not_mutate_running_agent(self, client):
        created = client.post("/desktop/api/sessions", json={})
        sid = created.json()["id"]

        from daemon.services.agent_pool import AgentPool

        class _FakeAgent:
            reasoning_config = {"enabled": True, "effort": "low"}

        with patch.object(AgentPool, "_build_agent", return_value=(_FakeAgent(), "gpt-4", "openai")):
            entry = client.app.state.agent_pool.get_or_create(sid)
            client.app.state.agent_pool.mark_running(sid)

            resp = client.patch(
                f"/desktop/api/sessions/{sid}/runtime",
                json={"reasoningEffort": "none"},
            )

            assert resp.status_code == 200
            assert resp.json()["appliedToActiveTurn"] is False
            assert resp.json()["appliesNextTurn"] is True
            assert entry.agent.reasoning_config == {"enabled": True, "effort": "low"}
            client.app.state.agent_pool.mark_idle(sid)

    def test_session_steer_calls_running_agent_steer(self, client):
        created = client.post("/desktop/api/sessions", json={})
        sid = created.json()["id"]

        from daemon.services.agent_pool import AgentPool

        class _FakeAgent:
            def __init__(self):
                self.steers = []

            def steer(self, text):
                self.steers.append(text)
                return True

        with patch.object(AgentPool, "_build_agent", return_value=(_FakeAgent(), "gpt-4", "openai")):
            entry = client.app.state.agent_pool.get_or_create(sid)
            client.app.state.agent_pool.mark_running(sid)

            resp = client.post(
                f"/desktop/api/sessions/{sid}/steer",
                json={"text": "  nudge the current run  "},
            )

            assert resp.status_code == 200
            assert resp.json() == {"status": "queued", "text": "nudge the current run"}
            assert entry.agent.steers == ["nudge the current run"]
            client.app.state.agent_pool.mark_idle(sid)

    def test_session_steer_rejects_when_session_is_idle(self, client):
        created = client.post("/desktop/api/sessions", json={})
        sid = created.json()["id"]

        resp = client.post(
            f"/desktop/api/sessions/{sid}/steer",
            json={"text": "nudge the current run"},
        )

        assert resp.status_code == 200
        assert resp.json() == {"status": "rejected", "text": "nudge the current run"}

    def test_set_permission_mode_rejects_invalid_value(self, client):
        created = client.post("/desktop/api/sessions", json={})
        sid = created.json()["id"]

        resp = client.put(
            f"/desktop/api/sessions/{sid}/permission-mode",
            json={"mode": "root"},
        )

        assert resp.status_code in {400, 422}
        assert client.get(f"/desktop/api/sessions/{sid}").json()["permissionMode"] == "auto"

    def test_create_session_does_not_reuse_session_with_messages(self, client):
        first = client.post("/desktop/api/sessions", json={})
        assert first.status_code == 200
        first_id = first.json()["id"]

        from daemon.db.ui_messages import append
        append(client.app.state.cfg.hermes_home, first_id, "user", {"text": "hi"})

        second = client.post("/desktop/api/sessions", json={})

        assert second.status_code == 200
        assert second.json()["id"] != first_id

    def test_create_session_does_not_reuse_session_with_core_db_messages(self, client):
        first = client.post("/desktop/api/sessions", json={})
        assert first.status_code == 200
        first_id = first.json()["id"]

        client.app.state.session_db.append_message(first_id, "user", "hi")

        second = client.post("/desktop/api/sessions", json={})

        assert second.status_code == 200
        assert second.json()["id"] != first_id

    def test_create_session_reuses_empty_session_after_delete_last_fallback(self, client):
        first = client.post("/desktop/api/sessions", json={})
        assert first.status_code == 200
        first_id = first.json()["id"]

        deleted = client.delete(f"/desktop/api/sessions/{first_id}")
        assert deleted.status_code == 200

        fallback = client.post("/desktop/api/sessions", json={})
        assert fallback.status_code == 200
        fallback_id = fallback.json()["id"]

        repeated = client.post("/desktop/api/sessions", json={})

        assert repeated.status_code == 200
        assert repeated.json()["id"] == fallback_id
        assert repeated.json()["reused"] is True

    def test_build_app_creates_default_workspace_on_startup(self, cfg, monkeypatch, tmp_path):
        default_workspace = tmp_path / "HermesAgentWorkspace"
        monkeypatch.setattr(session_service, "DEFAULT_WORKSPACE", default_workspace)

        build_app(cfg)

        assert default_workspace.is_dir()

    def test_list_sessions(self, client):
        # Create two sessions
        client.post("/desktop/api/sessions", json={"model": "gpt-4"})
        client.post("/desktop/api/sessions", json={"model": "claude"})

        resp = client.get("/desktop/api/sessions")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) >= 2

    def test_archive_session_is_desktop_local_overlay(self, client):
        first = client.post("/desktop/api/sessions", json={"model": "gpt-4"})
        second = client.post("/desktop/api/sessions", json={"model": "claude"})
        sid = first.json()["session_id"]
        other_sid = second.json()["session_id"]

        resp = client.patch(f"/desktop/api/sessions/{sid}", json={"archived": True})

        assert resp.status_code == 200
        assert resp.json()["archived"] is True
        default_list = client.get("/desktop/api/sessions").json()
        archived_list = client.get("/desktop/api/sessions?archived=only").json()
        include_list = client.get("/desktop/api/sessions?archived=include").json()
        assert not any(s["id"] == sid for s in default_list)
        assert any(s["id"] == other_sid for s in default_list)
        assert [s["id"] for s in archived_list] == [sid]
        assert any(s["id"] == sid and s["archived"] is True for s in include_list)

        core_row = client.app.state.session_db.get_session(sid)
        assert core_row is not None
        assert core_row.get("archived") == 0

        restore = client.patch(f"/desktop/api/sessions/{sid}", json={"archived": False})

        assert restore.status_code == 200
        assert restore.json()["archived"] is False
        restored_list = client.get("/desktop/api/sessions").json()
        assert any(s["id"] == sid and s["archived"] is False for s in restored_list)

    def test_get_session_404(self, client):
        resp = client.get("/desktop/api/sessions/nonexistent")
        assert resp.status_code == 404

    def test_rename_session(self, client):
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        resp = client.patch(f"/desktop/api/sessions/{sid}", json={"title": "Renamed"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_delete_session(self, client):
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        resp = client.delete(f"/desktop/api/sessions/{sid}")
        assert resp.status_code == 200

        # Verify it's gone
        resp = client.get(f"/desktop/api/sessions/{sid}")
        assert resp.status_code == 404

    def test_delete_session_removes_from_list(self, client):
        """Deleted session must not appear in list_sessions."""
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        # Verify it's in the list
        resp = client.get("/desktop/api/sessions")
        assert any(s["id"] == sid for s in resp.json())

        # Delete it
        resp = client.delete(f"/desktop/api/sessions/{sid}")
        assert resp.status_code == 200

        # Verify it's gone from the list
        resp = client.get("/desktop/api/sessions")
        assert not any(s["id"] == sid for s in resp.json())

    def test_delete_session_clears_messages(self, client):
        """Deleted session's ui_messages and get_session_messages return 404."""
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        # Add a message
        from daemon.db.ui_messages import append
        append(client.app.state.cfg.hermes_home, sid, "user", {"text": "hi"})

        # Verify messages exist
        resp = client.get(f"/desktop/api/sessions/{sid}/messages")
        assert resp.status_code == 200
        assert len(resp.json()) == 1

        # Delete session
        resp = client.delete(f"/desktop/api/sessions/{sid}")
        assert resp.status_code == 200

        # Messages should now 404
        resp = client.get(f"/desktop/api/sessions/{sid}/messages")
        assert resp.status_code == 404


class TestMessagesReplay:
    """ui_messages replay via GET /sessions/{sid}/messages."""

    def test_empty_messages(self, client):
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        resp = client.get(f"/desktop/api/sessions/{sid}/messages")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_since_filters(self, client):
        """Insert ui_messages rows directly, then verify since filter."""
        from daemon.db.ui_messages import append, list_messages

        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]
        home = client.app.state.cfg.hermes_home

        append(home, sid, "user", {"text": "msg1"})
        append(home, sid, "assistant_text_delta", {"text": "resp1"})
        append(home, sid, "user", {"text": "msg2"})

        # Without since — all 3
        resp = client.get(f"/desktop/api/sessions/{sid}/messages")
        assert len(resp.json()) == 3

        # With since=1 — 2 rows
        resp = client.get(f"/desktop/api/sessions/{sid}/messages?since=1")
        assert len(resp.json()) == 2
        assert resp.json()[0]["seq"] == 2

    def test_transcript_returns_canonical_turn_projection(self, client):
        from daemon.db.ui_messages import append

        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]
        home = client.app.state.cfg.hermes_home
        turn_id = "turn_transcript"

        append(home, sid, "user", {"text": "where is core logic"}, turn_id=turn_id)
        append(home, sid, "message.delta", {"text": "partial"}, turn_id=turn_id)
        append(home, sid, "message.complete", {"text": "final answer"}, turn_id=turn_id)

        resp = client.get(f"/desktop/api/sessions/{sid}/transcript")

        assert resp.status_code == 200
        data = resp.json()
        assert data["session_id"] == sid
        assert data["max_seq"] == 3
        assert data["live_turn"] is None
        assert [m["role"] for m in data["messages"]] == ["user", "assistant"]
        assert data["messages"][0]["turn_id"] == turn_id
        assert data["messages"][0]["content"] == "where is core logic"
        assert data["messages"][1]["turn_id"] == turn_id
        assert data["messages"][1]["content"] == "final answer"
        assert [block["type"] for block in data["messages"][1]["blocks"]] == ["text"]
        assert data["messages"][1]["blocks"][0]["content"] == "final answer"

    def test_transcript_keeps_running_turn_live(self, client):
        from daemon.db.ui_messages import append

        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]
        home = client.app.state.cfg.hermes_home
        turn_id = "turn_live"

        append(home, sid, "user", {"text": "continue"}, turn_id=turn_id)
        append(home, sid, "reasoning.delta", {"text": "thinking"}, turn_id=turn_id)
        append(home, sid, "message.delta", {"text": "partial"}, turn_id=turn_id)

        resp = client.get(f"/desktop/api/sessions/{sid}/transcript")

        assert resp.status_code == 200
        data = resp.json()
        assert [m["role"] for m in data["messages"]] == ["user"]
        assert data["live_turn"]["turn_id"] == turn_id
        assert data["live_turn"]["status"] == "running"
        assert data["live_turn"]["content"] == "partial"
        assert data["live_turn"]["reasoning"] == "thinking"
        assert [block["type"] for block in data["live_turn"]["blocks"]] == ["reasoning", "text"]


class TestPromptExecute:
    """POST /prompt/execute — core turn execution."""

    def test_404_for_unknown_session(self, client):
        resp = client.post("/desktop/api/prompt/execute", json={
            "message": "hello",
            "session_id": "nonexistent",
        })
        assert resp.status_code == 404

    def test_202_accepted_for_valid_session(self, client):
        """prompt/execute returns 202 and writes a user ui_message row."""
        # We need to mock the agent run to avoid real model calls.
        # The test verifies the HTTP plumbing, not the model output.
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        # Mock the agent pool's _build_agent so it doesn't try to import real hermes internals
        from daemon.services.agent_pool import AgentPool
        db = client.app.state.session_db
        original_update_token_counts = db.update_token_counts
        update_token_counts_calls = 0

        class _FakeAgent:
            def __init__(self):
                self._interrupted = False
                self.model = "gpt-4"
                self.provider = "openai"
                self.base_url = None
            def interrupt(self):
                self._interrupted = True
            def run_conversation(self, user_message, conversation_history):
                db.update_token_counts(
                    sid,
                    input_tokens=100,
                    output_tokens=50,
                    model="gpt-4",
                    estimated_cost_usd=0.001,
                    billing_provider="openai",
                    api_call_count=1,
                )
                return {"final_response": "mock response"}

        def _counting_update_token_counts(*args, **kwargs):
            nonlocal update_token_counts_calls
            update_token_counts_calls += 1
            return original_update_token_counts(*args, **kwargs)

        with (
            patch.object(AgentPool, "_build_agent", return_value=(_FakeAgent(), "gpt-4", "openai")),
            patch.object(db, "update_token_counts", side_effect=_counting_update_token_counts),
        ):
            resp = client.post("/desktop/api/prompt/execute", json={
                "message": "hello world",
                "session_id": sid,
            })

            assert resp.status_code == 202
            data = resp.json()
            assert data["status"] == "accepted"
            assert data["session_id"] == sid
            assert data["turn_id"].startswith("turn_")
            assert data["user_seq"] == 1

            # Give the daemon thread time to complete
            time.sleep(0.2)

            # Verify ui_messages were written
            resp2 = client.get(f"/desktop/api/sessions/{sid}/messages")
            msgs = resp2.json()
            assert len(msgs) >= 2  # user + message.complete at minimum
            types = [m["type"] for m in msgs]
            assert "user" in types
            assert "message.start" in types
            assert "message.complete" in types
            assert all(
                m["payload"].get("turn_id") == data["turn_id"]
                for m in msgs
                if m["type"] in {"user", "message.start", "message.complete"}
            )
            complete = next(m for m in msgs if m["type"] == "message.complete")
            assert complete["payload"]["usage"]["total"] == 150
            assert complete["payload"]["usage"]["input"] == 100
            assert complete["payload"]["usage"]["output"] == 50
            assert complete["payload"]["usage"]["cost_usd"] == 0.001
            assert update_token_counts_calls == 1

    def test_turn_error_produces_error_row(self, client):
        """When the agent raises, a turn_error ui_message is written."""
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        from daemon.services.agent_pool import AgentPool

        class _FailingAgent:
            def interrupt(self):
                pass
            def run_conversation(self, user_message, conversation_history):
                raise RuntimeError("simulated model failure")

        with patch.object(AgentPool, "_build_agent", return_value=(_FailingAgent(), "gpt-4", "openai")):
            resp = client.post("/desktop/api/prompt/execute", json={
                "message": "test",
                "session_id": sid,
            })

        assert resp.status_code == 202

        # Wait for thread
        time.sleep(0.3)

        resp2 = client.get(f"/desktop/api/sessions/{sid}/messages")
        msgs = resp2.json()
        types = [m["type"] for m in msgs]
        assert "turn_error" in types
        error_msg = next(m for m in msgs if m["type"] == "turn_error")
        assert error_msg["payload"]["code"] == "agent_error"
        assert error_msg["payload"]["turn_id"] == resp.json()["turn_id"]
        assert "simulated model failure" in error_msg["payload"]["hint"]

        transcript = client.get(f"/desktop/api/sessions/{sid}/transcript").json()
        assistant = [m for m in transcript["messages"] if m["role"] == "assistant"][-1]
        assert assistant["status"] == "failed"
        assert assistant["turn_id"] == resp.json()["turn_id"]

    def test_409_when_session_busy(self, client):
        """Second prompt/execute on a running session returns 409."""
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        from daemon.services.agent_pool import AgentPool
        import threading

        class _BlockingAgent:
            _interrupted = False
            def interrupt(self):
                self._interrupted = True
            def run_conversation(self, user_message, conversation_history):
                # Block until interrupted
                while not self._interrupted:
                    time.sleep(0.05)
                return "interrupted"

        with patch.object(AgentPool, "_build_agent", return_value=(_BlockingAgent(), "gpt-4", "openai")):
            # First prompt — starts and blocks
            resp1 = client.post("/desktop/api/prompt/execute", json={
                "message": "first",
                "session_id": sid,
            })
            assert resp1.status_code == 202

            # Give thread time to start
            time.sleep(0.1)

            # Second prompt — should get 409
            resp2 = client.post("/desktop/api/prompt/execute", json={
                "message": "second",
                "session_id": sid,
            })
            assert resp2.status_code == 409


class TestInterrupt:
    """POST /sessions/{sid}/interrupt."""

    def test_interrupt_idle_session_returns_409(self, client):
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]
        resp = client.post(f"/desktop/api/sessions/{sid}/interrupt")
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_interrupt_running_session(self, client):
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        from daemon.services.agent_pool import AgentPool
        import time

        class _InterruptibleAgent:
            _interrupted = False
            def interrupt(self):
                self._interrupted = True
            def run_conversation(self, user_message, conversation_history):
                while not self._interrupted:
                    time.sleep(0.05)
                return "interrupted"

        with patch.object(AgentPool, "_build_agent", return_value=(_InterruptibleAgent(), "gpt-4", "openai")):
            client.post("/desktop/api/prompt/execute", json={
                "message": "test",
                "session_id": sid,
            })
            time.sleep(0.1)  # let thread start

            resp = client.post(f"/desktop/api/sessions/{sid}/interrupt")
            assert resp.status_code == 200
            assert resp.json()["ok"] is True

            transcript = client.get(f"/desktop/api/sessions/{sid}/transcript").json()
            assert transcript["live_turn"] is None
            interrupted = [m for m in transcript["messages"] if m["role"] == "assistant"]
            assert interrupted
            assert interrupted[-1]["status"] == "interrupted"


def test_startup_reset_clears_only_desktop_conversation_data(tmp_path):
    from hermes_state import SessionDB
    from daemon.db.connection import connect, ensure_schema
    from daemon.db.ui_messages import append

    home = tmp_path / ".hermes"
    home.mkdir(parents=True)
    config_yaml = home / "config.yaml"
    config_yaml.write_text("model:\n  provider: openai\n  default: gpt-4\n")

    db = SessionDB(home / "state.db")
    db.create_session("desktop_old", "desktop", model="old")
    db.append_message("desktop_old", "user", "old desktop")
    db.create_session("cli_keep", "cli", model="keep")
    db.append_message("cli_keep", "user", "old cli")
    append(home, "desktop_old", "user", {"text": "old"}, turn_id="turn_old")

    conn = connect(home)
    ensure_schema(conn)
    conn.execute(
        "INSERT INTO model_overlays (provider_id, display_name) VALUES (?, ?)",
        ("openai", "OpenAI"),
    )
    conn.execute(
        "INSERT INTO desktop_settings (key, value) VALUES (?, ?)",
        ("theme", '"dark"'),
    )
    conn.execute("INSERT INTO session_desktop_meta (session_id) VALUES (?)", ("desktop_old",))
    conn.commit()
    conn.close()

    cfg = Config(hermes_home=home, port=18080, token=None)
    app = build_app(cfg)

    state_db = app.state.session_db
    assert state_db.get_session("desktop_old") is None
    assert state_db.get_session("cli_keep") is not None

    rows = client_rows = app.state.session_db.get_messages_as_conversation("cli_keep")
    assert rows and rows[0]["content"] == "old cli"

    conn = connect(home)
    ensure_schema(conn)
    assert conn.execute("SELECT COUNT(*) FROM session_desktop_meta").fetchone()[0] == 0
    assert conn.execute("SELECT display_name FROM model_overlays WHERE provider_id = 'openai'").fetchone()[0] == "OpenAI"
    assert conn.execute("SELECT value FROM desktop_settings WHERE key = 'theme'").fetchone()[0] == '"dark"'
    conn.close()

    from daemon.db.ui_messages import list_messages
    from daemon.db.conversation_turns import list_turns

    assert list_messages(home, "desktop_old") == []
    assert list_turns(home, "desktop_old") == []


def test_user_input_respond_is_idempotent_and_triggers_recovery(client):
    from daemon.db.ui_messages import append
    from daemon.db.user_input_prompts import create_request, get_request

    home = client.app.state.cfg.hermes_home
    sid = "sess-user-input-endpoint"
    turn_id = "turn-user-input-endpoint"
    append(home, sid, "user", {"text": "plan this"}, turn_id=turn_id)
    create_request(
        home,
        session_id=sid,
        turn_id=turn_id,
        request_id="req-endpoint",
        questions=[
            {
                "id": "scope",
                "header": "Scope",
                "question": "Which scope?",
                "options": [{"label": "Broad", "description": "Include recovery."}],
            }
        ],
    )

    class _FakeExec:
        def __init__(self):
            self.calls = []

        def resume_user_input_turn(self, **kwargs):
            self.calls.append(kwargs)
            return True

    fake_exec = _FakeExec()
    client.app.state.agent_exec_svc = fake_exec

    body = {
        "session_id": sid,
        "request_id": "req-endpoint",
        "answers": {"scope": {"answers": ["Broad"]}},
    }
    first = client.post("/desktop/api/user-input/respond", json=body)
    second = client.post("/desktop/api/user-input/respond", json=body)

    assert first.status_code == 200
    assert first.json()["resumed"] == "recovery"
    assert second.status_code == 200
    assert len(fake_exec.calls) == 1
    assert fake_exec.calls[0]["turn_id"] == turn_id
    assert get_request(home, "req-endpoint")["status"] == "resumed"


@pytest.mark.asyncio
async def test_sse_replays_only_pending_user_input_requests(client, monkeypatch):
    from daemon.db.ui_messages import append
    from daemon.db.user_input_prompts import create_request

    home = client.app.state.cfg.hermes_home
    monkeypatch.setenv("HERMES_HOME", str(home))
    sid = "sess-user-input-replay"
    turn_id = "turn-user-input-replay"
    append(home, sid, "user", {"text": "plan this"}, turn_id=turn_id)
    create_request(
        home,
        session_id=sid,
        turn_id=turn_id,
        request_id="req-replay",
        questions=[{"id": "scope", "header": "Scope", "question": "Which scope?", "options": []}],
    )

    pending_events = [event async for event in _replay_pending_user_inputs()]
    assert pending_events
    assert '"type": "user_input.request"' in pending_events[0]

    client.app.state.agent_exec_svc = MagicMock()
    client.post(
        "/desktop/api/user-input/respond",
        json={
            "session_id": sid,
            "request_id": "req-replay",
            "answers": {"scope": {"answers": ["Broad"]}},
        },
    )
    answered_events = [event async for event in _replay_pending_user_inputs()]
    assert answered_events == []


class TestSSEEventStream:
    """GET /events/stream — SSE streaming."""

    @pytest.mark.asyncio
    async def test_sse_stream_connects(self, client):
        """SSE stream responds with event-stream headers without blocking tests."""
        class _DisconnectedRequest:
            app = client.app

            async def is_disconnected(self):
                return True

        response = await event_stream(_DisconnectedRequest())

        assert response.status_code == 200
        assert response.media_type == "text/event-stream"
        assert response.headers["cache-control"] == "no-cache"
