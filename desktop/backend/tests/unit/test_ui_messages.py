"""Unit tests for desktop_backend.db.ui_messages."""
from __future__ import annotations

import json
import time

from desktop_backend.db.ui_messages import append, latest_seq, list_messages


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
