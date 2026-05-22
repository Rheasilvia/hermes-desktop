"""Context normalizer — port of Claude Code's normalizeMessagesForAPI.

Called on `llm_messages` before every agent turn to ensure validity:

1. Orphan tool_calls (assistant with tool_calls but no matching tool result)
   → insert a synthetic tool result with error content.
2. Orphan tool results (tool message without preceding assistant with tool_calls)
   → dropped.
3. Consecutive same-role messages → merged (content concatenated).
4. Empty-content messages → filtered out.
5. Provider-specific field trimming (e.g., name on tool messages for OpenAI).

Pure function.  Idempotent: normalize(normalize(x)) == normalize(x).
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional


def normalize_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalize a list of LLM messages for API consumption.

    Returns a new list; does not mutate the input.

    Handles both OpenAI-format tool_calls and Anthropic-format tool_use
    content blocks.
    """
    if not messages:
        return []

    # Work on a copy
    msgs: List[Dict[str, Any]] = [copy.deepcopy(m) for m in messages]

    # ── Pass 1: pair tool_calls with tool results, fix orphans ──────────
    msgs = _fix_tool_pairing(msgs)

    # ── Pass 2: merge consecutive same-role messages ────────────────────
    msgs = _merge_consecutive_same_role(msgs)

    # ── Pass 3: filter empty messages ───────────────────────────────────
    msgs = _filter_empty(msgs)

    # ── Pass 4: trim provider-specific fields ───────────────────────────
    msgs = _trim_fields(msgs)

    return msgs


# ── Pass 1: tool-use / tool-result pairing ────────────────────────────────────

def _fix_tool_pairing(msgs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Fix orphan tool_calls and orphan tool_result messages."""
    result: List[Dict[str, Any]] = []
    pending_tool_ids: set[str] = set()  # tool_call ids waiting for a result

    for msg in msgs:
        role = msg.get("role", "")

        if role == "assistant":
            tool_calls = msg.get("tool_calls")
            if tool_calls:
                for tc in tool_calls:
                    tc_id = tc.get("id") if isinstance(tc, dict) else None
                    if tc_id:
                        pending_tool_ids.add(tc_id)
            result.append(msg)

        elif role == "tool":
            tc_id = msg.get("tool_call_id", "")
            if tc_id in pending_tool_ids:
                pending_tool_ids.discard(tc_id)
                result.append(msg)
            else:
                # Orphan tool result — drop it
                pass

        else:
            # system / user messages
            # If there are pending tool calls at this point, they're orphaned.
            # Insert synthetic error results before this message.
            if pending_tool_ids:
                for tc_id in list(pending_tool_ids):
                    result.append(_synthetic_tool_error(tc_id))
                    pending_tool_ids.discard(tc_id)
            result.append(msg)

    # Any remaining pending tool calls at end of conversation
    if pending_tool_ids:
        for tc_id in list(pending_tool_ids):
            result.append(_synthetic_tool_error(tc_id))

    return result


def _synthetic_tool_error(tool_call_id: str) -> Dict[str, Any]:
    return {
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": '{"is_error": true, "content": "interrupted"}',
    }


# ── Pass 2: merge consecutive same-role messages ──────────────────────────────

def _merge_consecutive_same_role(msgs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge consecutive messages with the same role.

    For 'assistant' messages, tool_calls lists are concatenated.
    For 'user' and 'system', content strings are joined with newline.
    'tool' messages are NOT merged (each corresponds to a specific tool_call_id).
    """
    if not msgs:
        return []

    merged: List[Dict[str, Any]] = [copy.deepcopy(msgs[0])]

    for msg in msgs[1:]:
        prev = merged[-1]
        role = msg.get("role", "")
        prev_role = prev.get("role", "")

        if role == prev_role and role in ("user", "system"):
            # Merge content
            prev_content = prev.get("content") or ""
            msg_content = msg.get("content") or ""
            if isinstance(prev_content, str) and isinstance(msg_content, str):
                prev["content"] = (prev_content + "\n" + msg_content).strip()
            elif isinstance(prev_content, list) and isinstance(msg_content, list):
                prev["content"] = prev_content + msg_content

        elif role == prev_role and role == "assistant":
            # Merge tool_calls if both have them, otherwise merge content
            prev_tcs = prev.get("tool_calls")
            msg_tcs = msg.get("tool_calls")
            if prev_tcs and msg_tcs:
                prev["tool_calls"] = prev_tcs + msg_tcs
            elif not prev_tcs and not msg_tcs:
                prev_content = prev.get("content") or ""
                msg_content = msg.get("content") or ""
                if isinstance(prev_content, str) and isinstance(msg_content, str):
                    prev["content"] = (prev_content + "\n" + msg_content).strip()
                elif isinstance(prev_content, list) and isinstance(msg_content, list):
                    prev["content"] = prev_content + msg_content
            else:
                # One has tool_calls, one doesn't — keep separate
                merged.append(copy.deepcopy(msg))

        else:
            merged.append(copy.deepcopy(msg))

    return merged


# ── Pass 3: filter empty messages ─────────────────────────────────────────────

def _filter_empty(msgs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove messages with no content AND no tool_calls."""
    result: List[Dict[str, Any]] = []
    for msg in msgs:
        content = msg.get("content")
        tool_calls = msg.get("tool_calls")
        role = msg.get("role", "")

        # Tool messages should always be kept (they carry tool results)
        if role == "tool":
            result.append(msg)
            continue

        has_content = bool(
            content
            and (
                (isinstance(content, str) and content.strip())
                or (isinstance(content, list) and len(content) > 0)
            )
        )
        has_tool_calls = bool(tool_calls and len(tool_calls) > 0)

        if has_content or has_tool_calls:
            result.append(msg)

    return result


# ── Pass 4: trim provider-specific fields ─────────────────────────────────────

def _trim_fields(msgs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Remove fields that common providers reject.

    - 'name' on non-tool roles (some providers reject it)
    - 'tool_call_id' on non-tool roles
    """
    for msg in msgs:
        role = msg.get("role", "")

        # Remove 'name' from non-tool, non-assistant (tool_calls context) msgs
        if role not in ("tool",):
            msg.pop("name", None)

        # Remove 'tool_call_id' from non-tool msgs
        if role != "tool":
            msg.pop("tool_call_id", None)

    return msgs
