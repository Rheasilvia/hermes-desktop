"""Unit tests for desktop auto-title service."""

from __future__ import annotations

from daemon.services.session_state_service import SessionStateService
from daemon.services.title_service import TitleService
from hermes_state import SessionDB


class _Bus:
    def __init__(self) -> None:
        self.events: list[tuple[str, int, str, dict]] = []

    def publish(self, session_id: str, seq: int, msg_type: str, payload: dict) -> None:
        self.events.append((session_id, seq, msg_type, payload))


def test_auto_title_allows_duplicate_generated_titles(tmp_path, monkeypatch):
    db = SessionDB(db_path=tmp_path / "state.db")
    db.create_session("existing", "desktop")
    db.create_session("current", "desktop")
    db.set_session_title("existing", "Checking Current Directory with pwd")

    def fake_generate_title(**_kwargs):
        return "Checking Current Directory with pwd"

    monkeypatch.setattr("agent.title_generator.generate_title", fake_generate_title)
    bus = _Bus()
    service = TitleService(
        state=SessionStateService(db),
        event_bus=bus,
        agent_pool=None,
    )

    service._generate_title_bg("current", "使用 pwd 看下当前是在哪个目录", agent=object(), title_model="test")

    assert db.get_session_title("existing") == "Checking Current Directory with pwd"
    assert db.get_session_title("current") == "Checking Current Directory with pwd"
    assert bus.events == [
        (
            "current",
            0,
            "session.title_update",
            {"title": "Checking Current Directory with pwd"},
        )
    ]
    db.close()
