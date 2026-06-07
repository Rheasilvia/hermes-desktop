"""Unit tests for daemon.db.ui_messages."""
from __future__ import annotations

import json
import time

from daemon.db.ui_messages import append, clear_all, latest_seq, list_messages


def test_turn_projection_materializes_completed_turn(tmp_path):
    """Raw turn events update the canonical conversation_turns read model."""
    from daemon.db.conversation_turns import list_turns

    home = tmp_path / ".hermes"
    sid = "sess-turn"
    turn_id = "turn_abc123"

    user_seq = append(home, sid, "user", {"text": "find core logic"}, turn_id=turn_id)
    append(home, sid, "reasoning.delta", {"text": "thinking\n"}, turn_id=turn_id)
    append(home, sid, "tool.start", {"tool_id": "tool_1", "name": "search_files"}, turn_id=turn_id)
    append(
        home,
        sid,
        "tool.complete",
        {"tool_id": "tool_1", "name": "search_files", "summary": "2 files", "duration_s": 1.2},
        turn_id=turn_id,
    )
    terminal_seq = append(home, sid, "message.complete", {"text": "core is in app.py"}, turn_id=turn_id)

    turns = list_turns(home, sid)

    assert len(turns) == 1
    assert turns[0]["turn_id"] == turn_id
    assert turns[0]["user_seq"] == user_seq
    assert turns[0]["user_text"] == "find core logic"
    assert turns[0]["status"] == "completed"
    assert turns[0]["assistant_content"] == "core is in app.py"
    assert turns[0]["assistant_reasoning"] == "thinking\n"
    assert turns[0]["terminal_seq"] == terminal_seq
    assert turns[0]["tools"][0]["id"] == "tool_1"
    assert turns[0]["tools"][0]["status"] == "complete"
    assert turns[0]["tools"][0]["durationMs"] == 1200
    assert [block["type"] for block in turns[0]["assistant_blocks"]] == [
        "reasoning",
        "tool_call",
        "text",
    ]
    assert turns[0]["assistant_blocks"][1]["toolId"] == "tool_1"
    assert turns[0]["assistant_blocks"][1]["status"] == "complete"
    assert turns[0]["assistant_blocks"][2]["content"] == "core is in app.py"


def test_turn_projection_persists_user_display_parts(tmp_path):
    from daemon.db.conversation_turns import list_turns
    from daemon.services.session_service import SessionService

    home = tmp_path / ".hermes"
    sid = "sess-display-parts"
    turn_id = "turn_display_parts"
    display_parts = [
        {
            "type": "file_ref",
            "refText": "@file:docs/a.ts:1-2",
            "name": "a.ts",
            "detail": "docs/a.ts:1-2",
            "anchor": "File 1",
            "lineStart": 1,
            "lineEnd": 2,
        },
        {"type": "text", "text": " explain this"},
    ]

    append(
        home,
        sid,
        "user",
        {"text": "[File 1: a.ts:L1-L2] explain this", "display_parts": display_parts},
        turn_id=turn_id,
    )
    append(home, sid, "message.complete", {"text": "done"}, turn_id=turn_id)

    turns = list_turns(home, sid)
    assert turns[0]["user_display_parts"] == display_parts

    transcript = SessionService(home, state=None, meta=None).get_transcript(sid)  # type: ignore[arg-type]
    user = next(message for message in transcript["messages"] if message["role"] == "user")
    assert user["display_parts"] == display_parts


def test_turn_projection_preserves_ordered_assistant_blocks(tmp_path):
    from daemon.db.conversation_turns import list_turns
    from daemon.services.session_service import SessionService

    home = tmp_path / ".hermes"
    sid = "sess-ordered-blocks"
    turn_id = "turn_ordered"

    append(home, sid, "user", {"text": "debug this"}, turn_id=turn_id)
    append(home, sid, "message.delta", {"text": "I will inspect first.\n"}, turn_id=turn_id)
    for idx, name in enumerate(["terminal", "read_file", "read_file"], start=1):
        tool_id = f"tool_{idx}"
        append(home, sid, "tool.start", {"tool_id": tool_id, "name": name}, turn_id=turn_id)
        append(
            home,
            sid,
            "tool.complete",
            {"tool_id": tool_id, "name": name, "summary": f"{name} done", "duration_s": 0.1},
            turn_id=turn_id,
        )
    append(home, sid, "message.delta", {"text": "Final answer."}, turn_id=turn_id)
    append(
        home,
        sid,
        "message.complete",
        {"text": "I will inspect first.\nFinal answer."},
        turn_id=turn_id,
    )

    turn = list_turns(home, sid)[0]
    blocks = turn["assistant_blocks"]

    assert [
        block["name"] if block["type"] == "tool_call" else block["type"]
        for block in blocks
    ] == ["text", "terminal", "read_file", "read_file", "text"]
    assert blocks[0]["content"] == "I will inspect first.\n"
    assert blocks[-1]["content"] == "Final answer."

    transcript = SessionService(home, state=None, meta=None).get_transcript(sid)  # type: ignore[arg-type]
    assistant = next(message for message in transcript["messages"] if message["role"] == "assistant")
    assert assistant["blocks"] == blocks


def test_turn_projection_deduplicates_complete_text_with_trimmed_leading_stream_whitespace(tmp_path):
    from daemon.db.conversation_turns import list_turns

    home = tmp_path / ".hermes"
    sid = "sess-leading-whitespace"
    turn_id = "turn_pwd"
    final_text = "当前目录是：\n\n```\n/Users/chenmengjie/Documents/Repos/claude-code-source-code\n```"

    append(home, sid, "user", {"text": "使用 pwd 看下当前是在哪个目录"}, turn_id=turn_id)
    append(home, sid, "tool.start", {"tool_id": "tool_pwd", "name": "terminal"}, turn_id=turn_id)
    append(
        home,
        sid,
        "tool.complete",
        {"tool_id": "tool_pwd", "name": "terminal", "summary": "done", "duration_s": 0.1},
        turn_id=turn_id,
    )
    append(home, sid, "message.delta", {"text": f"\n\n{final_text}"}, turn_id=turn_id)
    append(home, sid, "message.complete", {"text": final_text}, turn_id=turn_id)

    blocks = list_turns(home, sid)[0]["assistant_blocks"]
    text_blocks = [block for block in blocks if block["type"] == "text"]

    assert [
        block["name"] if block["type"] == "tool_call" else block["type"]
        for block in blocks
    ] == ["terminal", "text"]
    assert len(text_blocks) == 1
    assert text_blocks[0]["content"] == f"\n\n{final_text}"


def test_turn_projection_treats_complete_text_as_snapshot_after_streamed_text(tmp_path):
    from daemon.db.conversation_turns import list_turns

    home = tmp_path / ".hermes"
    sid = "sess-final-text"
    turn_id = "turn_final_text"

    append(home, sid, "user", {"text": "inspect then answer"}, turn_id=turn_id)
    append(home, sid, "message.delta", {"text": "I will inspect first."}, turn_id=turn_id)
    append(home, sid, "tool.start", {"tool_id": "tool_1", "name": "terminal"}, turn_id=turn_id)
    append(
        home,
        sid,
        "tool.complete",
        {"tool_id": "tool_1", "name": "terminal", "summary": "done", "duration_s": 0.1},
        turn_id=turn_id,
    )
    append(home, sid, "message.complete", {"text": "Final answer."}, turn_id=turn_id)

    turn = list_turns(home, sid)[0]
    blocks = turn["assistant_blocks"]

    assert [
        block["name"] if block["type"] == "tool_call" else block["type"]
        for block in blocks
    ] == ["text", "terminal"]
    assert blocks[0]["content"] == "I will inspect first."
    assert turn["assistant_content"] == "Final answer."


def test_interrupted_turn_is_terminal_for_late_events(tmp_path):
    from daemon.db.conversation_turns import list_turns

    home = tmp_path / ".hermes"
    sid = "sess-interrupt"
    turn_id = "turn_interrupted"

    append(home, sid, "user", {"text": "start"}, turn_id=turn_id)
    interrupted_seq = append(home, sid, "turn.interrupted", {"reason": "user_interrupt"}, turn_id=turn_id)
    append(home, sid, "message.delta", {"text": "late"}, turn_id=turn_id)
    append(home, sid, "message.complete", {"text": "late complete"}, turn_id=turn_id)

    turn = list_turns(home, sid)[0]

    assert turn["status"] == "interrupted"
    assert turn["terminal_seq"] == interrupted_seq
    assert turn["assistant_content"] == ""


def test_turn_id_is_stored_in_column_and_payload_without_mutating_input(tmp_path):
    home = tmp_path / ".hermes"
    sid = "sess-turn-id"
    turn_id = "turn_payload"
    payload = {"text": "hello"}

    append(home, sid, "user", payload, turn_id=turn_id)

    rows = list_messages(home, sid)
    stored_payload = json.loads(rows[0]["payload_json"])
    assert rows[0]["turn_id"] == turn_id
    assert stored_payload["turn_id"] == turn_id
    assert payload == {"text": "hello"}


def test_clear_all_migrates_legacy_ui_messages_without_turn_id(tmp_path):
    """Reset must handle existing desktop_ui.db files from before turn_id."""
    import sqlite3

    home = tmp_path / ".hermes"
    db_path = home / "desktop" / "desktop_ui.db"
    db_path.parent.mkdir(parents=True)
    conn = sqlite3.connect(str(db_path))
    conn.executescript(
        """
        CREATE TABLE ui_messages (
            session_id   TEXT    NOT NULL,
            seq          INTEGER NOT NULL,
            type         TEXT    NOT NULL,
            payload_json TEXT    NOT NULL,
            created_at   REAL    NOT NULL,
            PRIMARY KEY (session_id, seq)
        );
        CREATE INDEX idx_ui_msgs_sid_seq ON ui_messages(session_id, seq);
        INSERT INTO ui_messages (session_id, seq, type, payload_json, created_at)
        VALUES ('legacy', 1, 'user', '{"text":"old"}', 1.0);
        """
    )
    conn.commit()
    conn.close()

    clear_all(home)
    append(home, "fresh", "user", {"text": "new"}, turn_id="turn_new")

    rows = list_messages(home, "fresh")
    assert rows[0]["turn_id"] == "turn_new"


def test_append_returns_monotonic_seq(tmp_path):
    """Each append returns an incrementing seq per session."""
    home = tmp_path / ".hermes"
    sid = "sess-a"

    s1 = append(home, sid, "user", {"text": "hello"})
    s2 = append(home, sid, "assistant_text_delta", {"text": "hi"})
    s3 = append(home, sid, "assistant_text_final", {"text": "hi there"})

    assert s1 == 1
    assert s2 == 2
    assert s3 == 3


def test_seqs_are_per_session(tmp_path):
    """Different sessions have independent seq counters."""
    home = tmp_path / ".hermes"

    append(home, "sess-a", "user", {"text": "a1"})
    append(home, "sess-a", "user", {"text": "a2"})
    append(home, "sess-b", "user", {"text": "b1"})

    assert latest_seq(home, "sess-a") == 2
    assert latest_seq(home, "sess-b") == 1


def test_latest_seq_returns_zero_for_unknown_session(tmp_path):
    home = tmp_path / ".hermes"
    assert latest_seq(home, "no-such-session") == 0


def test_list_without_since_returns_all(tmp_path):
    home = tmp_path / ".hermes"
    sid = "sess-c"

    append(home, sid, "user", {"text": "q"})
    append(home, sid, "assistant_text_delta", {"text": "a"})

    rows = list_messages(home, sid)
    assert len(rows) == 2
    assert rows[0]["seq"] == 1
    assert rows[0]["type"] == "user"
    assert rows[1]["seq"] == 2
    assert rows[1]["type"] == "assistant_text_delta"


def test_list_with_since_filters(tmp_path):
    home = tmp_path / ".hermes"
    sid = "sess-d"

    append(home, sid, "user", {"text": "1"})
    append(home, sid, "user", {"text": "2"})
    append(home, sid, "user", {"text": "3"})

    rows = list_messages(home, sid, since_seq=1)
    assert len(rows) == 2
    assert rows[0]["seq"] == 2
    assert rows[1]["seq"] == 3


def test_payload_is_valid_json(tmp_path):
    home = tmp_path / ".hermes"
    sid = "sess-e"

    append(home, sid, "tool_call_start", {"tool_id": "t1", "name": "read_file"})

    rows = list_messages(home, sid)
    payload = json.loads(rows[0]["payload_json"])
    assert payload == {"tool_id": "t1", "name": "read_file"}


def test_schema_is_idempotent(tmp_path):
    """Calling append multiple times against the same path does not error."""
    home = tmp_path / ".hermes"
    sid = "sess-idem"

    # First call creates schema
    append(home, sid, "user", {"text": "x"})
    # Second call — _ensure_schema is a no-op
    append(home, sid, "assistant_text_delta", {"text": "y"})

    rows = list_messages(home, sid)
    assert len(rows) == 2
