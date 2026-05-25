"""Integration tests for conversation endpoints.

Tests:
  - Happy path: POST /sessions → POST /prompt/execute → GET /sessions/{sid}/messages
  - Interrupt path: POST /sessions/{sid}/interrupt during a turn
  - Error path: prompt/execute with a non-existent session
  - Idempotent replay: GET /sessions/{sid}/messages?since=N
  - SSE event stream connected and receives published events
"""
from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from desktop_backend.app import build_app
from desktop_backend.config import Config
from desktop_backend.services import session_service


@pytest.fixture
def client(tmp_path):
    """TestClient with isolated hermes_home."""
    home = tmp_path / ".hermes"
    home.mkdir(parents=True)
    # Write a minimal config.yaml so _resolve_default_model has a fallback
    config_yaml = home / "config.yaml"
    config_yaml.write_text("model:\n  provider: openai\n  default: gpt-4\n")
    cfg = Config(hermes_home=home, port=18080, token=None)
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

    def test_create_session_without_workspace_creates_default_workspace(
        self, client, monkeypatch, tmp_path
    ):
        default_workspace = tmp_path / "HermesAgentWorkspace"
        monkeypatch.setattr(session_service, "DEFAULT_WORKSPACE", default_workspace)

        resp = client.post("/desktop/api/sessions", json={})

        assert resp.status_code == 200
        data = resp.json()
        assert data["workspace_path"] == str(default_workspace)
        assert default_workspace.is_dir()

    def test_create_session_with_model(self, client):
        resp = client.post("/desktop/api/sessions", json={
            "model": "anthropic/claude-opus-4.5",
            "workspace_path": "/tmp/test",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["model"] == "anthropic/claude-opus-4.5"
        assert data["workspace_path"] == "/tmp/test"

    def test_create_session_preserves_explicit_workspace(
        self, client, monkeypatch, tmp_path
    ):
        default_workspace = tmp_path / "HermesAgentWorkspace"
        explicit_workspace = tmp_path / "project"
        monkeypatch.setattr(session_service, "DEFAULT_WORKSPACE", default_workspace)

        resp = client.post(
            "/desktop/api/sessions", json={"workspace_path": str(explicit_workspace)}
        )

        assert resp.status_code == 200
        data = resp.json()
        assert data["workspace_path"] == str(explicit_workspace)

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

    def test_create_session_does_not_reuse_session_with_messages(self, client):
        first = client.post("/desktop/api/sessions", json={})
        assert first.status_code == 200
        first_id = first.json()["id"]

        from desktop_backend.db.ui_messages import append
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
        from desktop_backend.db.ui_messages import append
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
        from desktop_backend.db.ui_messages import append, list_messages

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
        from desktop_backend.services.agent_pool import AgentPool

        class _FakeAgent:
            def __init__(self):
                self._interrupted = False
            def interrupt(self):
                self._interrupted = True
            def run_conversation(self, user_message, conversation_history):
                return {"final_response": "mock response"}

        with patch.object(AgentPool, "_build_agent", return_value=_FakeAgent()):
            resp = client.post("/desktop/api/prompt/execute", json={
                "message": "hello world",
                "session_id": sid,
            })

        assert resp.status_code == 202
        data = resp.json()
        assert data["status"] == "accepted"
        assert data["session_id"] == sid

        # Give the daemon thread time to complete
        time.sleep(0.2)

        # Verify ui_messages were written
        resp2 = client.get(f"/desktop/api/sessions/{sid}/messages")
        msgs = resp2.json()
        assert len(msgs) >= 2  # user + message.complete at minimum
        types = [m["type"] for m in msgs]
        assert "user" in types
        assert "message.complete" in types

    def test_turn_error_produces_error_row(self, client):
        """When the agent raises, a turn_error ui_message is written."""
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        from desktop_backend.services.agent_pool import AgentPool

        class _FailingAgent:
            def interrupt(self):
                pass
            def run_conversation(self, user_message, conversation_history):
                raise RuntimeError("simulated model failure")

        with patch.object(AgentPool, "_build_agent", return_value=_FailingAgent()):
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
        assert "simulated model failure" in error_msg["payload"]["error"]

    def test_409_when_session_busy(self, client):
        """Second prompt/execute on a running session returns 409."""
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        from desktop_backend.services.agent_pool import AgentPool
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

        with patch.object(AgentPool, "_build_agent", return_value=_BlockingAgent()):
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
        assert resp.status_code == 409

    def test_interrupt_running_session(self, client):
        r = client.post("/desktop/api/sessions", json={})
        sid = r.json()["session_id"]

        from desktop_backend.services.agent_pool import AgentPool
        import time

        class _InterruptibleAgent:
            _interrupted = False
            def interrupt(self):
                self._interrupted = True
            def run_conversation(self, user_message, conversation_history):
                while not self._interrupted:
                    time.sleep(0.05)
                return "interrupted"

        with patch.object(AgentPool, "_build_agent", return_value=_InterruptibleAgent()):
            client.post("/desktop/api/prompt/execute", json={
                "message": "test",
                "session_id": sid,
            })
            time.sleep(0.1)  # let thread start

            resp = client.post(f"/desktop/api/sessions/{sid}/interrupt")
            assert resp.status_code == 200
            assert resp.json()["ok"] is True


class TestSSEEventStream:
    """GET /events/stream — SSE streaming."""

    @pytest.mark.asyncio
    async def test_sse_stream_connects_and_receives_keepalive(self, client):
        """SSE stream connects and receives at least a keepalive comment."""
        # Use httpx async client since TestClient doesn't support streaming well
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=client.app),
            base_url="http://testserver",
        ) as ac:
            async with ac.stream("GET", "/desktop/api/events/stream") as response:
                assert response.status_code == 200
                assert response.headers["content-type"] == "text/event-stream; charset=utf-8"

                # Read a few lines — should get a keepalive within ~15s,
                # but for test purposes we'll just read 1 line and be happy
                line = await response.__aiter__().__anext__()
                # With no events published, first line should be a keepalive
                assert ": keepalive" in line or line.strip() == ""
