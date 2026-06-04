"""Unit tests for context_normalizer."""
from __future__ import annotations

from daemon.services.context_normalizer import normalize_messages


def _make_msg(role: str, content: str | None = None, **kwargs):
    m = {"role": role}
    if content is not None:
        m["content"] = content
    m.update(kwargs)
    return m


# ── Orphan tool_use → synthetic tool_result ────────────────────────────────────


def test_orphan_tool_call_gets_synthetic_error():
    """An assistant with tool_calls but no following tool result → synthetic error inserted."""
    msgs = [
        _make_msg("user", "run tests"),
        _make_msg(
            "assistant",
            content=None,
            tool_calls=[{"id": "tc1", "type": "function", "function": {"name": "run_tests", "arguments": "{}"}}],
        ),
        _make_msg("user", "next question"),
    ]
    result = normalize_messages(msgs)

    # Should have: user, assistant, tool(synthetic), user
    assert len(result) == 4
    assert result[2]["role"] == "tool"
    assert result[2]["tool_call_id"] == "tc1"
    assert '"is_error": true' in result[2]["content"]


def test_orphan_tool_call_at_end_gets_synthetic_error():
    """Trailing assistant with tool_calls → synthetic error appended."""
    msgs = [
        _make_msg("user", "run tests"),
        _make_msg(
            "assistant",
            content=None,
            tool_calls=[{"id": "tc_end", "type": "function", "function": {"name": "shell", "arguments": "{}"}}],
        ),
    ]
    result = normalize_messages(msgs)

    assert len(result) == 3  # user, assistant, tool(synthetic)
    assert result[2]["role"] == "tool"
    assert result[2]["tool_call_id"] == "tc_end"


# ── Orphan tool_result → dropped ───────────────────────────────────────────────


def test_orphan_tool_result_dropped():
    """A tool message without a preceding assistant with tool_calls → dropped."""
    msgs = [
        _make_msg("user", "hello"),
        _make_msg("tool", "result", tool_call_id="orphan_tc"),
        _make_msg("assistant", "hi"),
    ]
    result = normalize_messages(msgs)

    roles = [m["role"] for m in result]
    assert roles == ["user", "assistant"]


# ── Consecutive same-role merging ─────────────────────────────────────────────


def test_consecutive_user_messages_merged():
    msgs = [
        _make_msg("user", "hello"),
        _make_msg("user", "world"),
    ]
    result = normalize_messages(msgs)

    assert len(result) == 1
    assert "hello" in result[0]["content"]
    assert "world" in result[0]["content"]


def test_consecutive_assistant_messages_merged():
    msgs = [
        _make_msg("assistant", "first"),
        _make_msg("assistant", "second"),
    ]
    result = normalize_messages(msgs)

    assert len(result) == 1
    assert "first" in result[0]["content"]
    assert "second" in result[0]["content"]


def test_consecutive_system_messages_merged():
    msgs = [
        _make_msg("system", "a"),
        _make_msg("system", "b"),
    ]
    result = normalize_messages(msgs)

    assert len(result) == 1
    assert "a" in result[0]["content"]
    assert "b" in result[0]["content"]


def test_tool_messages_not_merged():
    """Each tool message corresponds to a different tool_call_id — never merge them."""
    msgs = [
        _make_msg(
            "assistant",
            content=None,
            tool_calls=[
                {"id": "t1", "type": "function", "function": {"name": "a", "arguments": "{}"}},
                {"id": "t2", "type": "function", "function": {"name": "b", "arguments": "{}"}},
            ],
        ),
        _make_msg("tool", "r1", tool_call_id="t1"),
        _make_msg("tool", "r2", tool_call_id="t2"),
    ]
    result = normalize_messages(msgs)

    roles = [m["role"] for m in result]
    assert roles.count("tool") == 2


# ── Empty message filtering ───────────────────────────────────────────────────


def test_empty_content_filtered():
    msgs = [
        _make_msg("user", "hello"),
        _make_msg("assistant", ""),
        _make_msg("assistant", "  "),
    ]
    result = normalize_messages(msgs)

    assert len(result) == 1
    assert result[0]["role"] == "user"


def test_assistant_with_only_tool_calls_kept():
    msgs = [
        _make_msg(
            "assistant",
            content=None,
            tool_calls=[{"id": "tc_keep", "type": "function", "function": {"name": "f", "arguments": "{}"}}],
        ),
        _make_msg("tool", "ok", tool_call_id="tc_keep"),
    ]
    result = normalize_messages(msgs)

    assert len(result) == 2  # assistant (tool_calls) + tool


# ── Provider field trimming ───────────────────────────────────────────────────


def test_trim_fields():
    msgs = [
        _make_msg("user", "hi", name="alice", tool_call_id="should_be_removed"),
    ]
    result = normalize_messages(msgs)

    assert "name" not in result[0]
    assert "tool_call_id" not in result[0]


# ── Idempotency ────────────────────────────────────────────────────────────────


def test_normalize_is_idempotent():
    msgs = [
        _make_msg("user", "hello"),
        _make_msg("user", "world"),  # consecutive same-role
        _make_msg(
            "assistant",
            content=None,
            tool_calls=[{"id": "orphan", "type": "function", "function": {"name": "f", "arguments": "{}"}}],
        ),
        _make_msg("tool", "orphan_result", tool_call_id="no_such_tc"),  # orphan tool result
    ]
    first = normalize_messages(msgs)
    second = normalize_messages(first)

    assert first == second


def test_normalize_handles_empty_list():
    assert normalize_messages([]) == []


# ── Full interrupted turn scenario ────────────────────────────────────────────


def test_interrupted_turn_repair():
    """Simulate a turn where the model streamed a tool call but was interrupted
    before the tool result arrived."""
    msgs = [
        _make_msg("system", "You are helpful."),
        _make_msg("user", "read file x.py"),
        _make_msg(
            "assistant",
            content="Let me read that file.",
            tool_calls=[{"id": "tc_read", "type": "function", "function": {"name": "read_file", "arguments": '{"path":"x.py"}'}}],
        ),
        # Interrupted here — no tool result
        _make_msg("user", "also check y.py"),
    ]
    result = normalize_messages(msgs)

    # Should have: system, user, assistant, tool(synthetic error), user
    assert len(result) == 5
    assert result[3]["role"] == "tool"
    assert result[3]["tool_call_id"] == "tc_read"
    assert "interrupted" in result[3]["content"]

    # Next turn should still be valid — idempotent pass
    again = normalize_messages(result)
    assert again == result
