"""Unit tests for CommandService dispatch (Desktop slash-command cards).

Covers the Desktop categorization buckets — lifecycle session actions, inline
cards (live-data + CLI-text), deferred, and terminal-only — plus the drift guard
that keeps every shared ``COMMAND_REGISTRY`` command accounted for in exactly one
bucket.
"""
from __future__ import annotations

import typing

import pytest

from desktop_backend.schemas.commands import ActionName, CardType
from desktop_backend.services.command_service import (
    _CARD_COMMANDS,
    _CLI_CARD,
    _DEFERRED,
    _DESKTOP_HIDDEN,
    _INLINE_HANDLED,
    _SESSION_ACTION_ALIASES,
    _SESSION_ACTIONS,
    _TERMINAL_ONLY,
    _UNSUPPORTED,
    CommandService,
)


def _make_service(tmp_path) -> CommandService:
    # Lifecycle actions and live-data card directives resolve without touching
    # the session service or agent pool.
    return CommandService(hermes_home=tmp_path, session_service=None, agent_pool=None)


@pytest.mark.parametrize(
    "command,arg,kind,action,card_type",
    [
        # Lifecycle session actions
        ("new", "", "action", "new", None),
        ("new", "Foo", "action", "new", None),
        ("reset", "", "action", "new", None),          # alias of /new
        ("branch", "", "action", "branch", None),
        ("fork", "", "action", "branch", None),         # alias of /branch
        ("resume", "Foo", "action", "resume", None),
        ("title", "Hi", "action", "title", None),
        ("clear", "", "action", "new", None),          # /clear → fresh session
        # Live-data inline cards
        ("history", "", "card", None, "sessions"),
        ("sessions", "", "card", None, "sessions"),
        ("tools", "", "card", None, "tools"),
        ("skills", "", "card", None, "skills"),
        ("cron", "", "card", None, "cron"),
        ("plugins", "", "card", None, "plugins"),
        ("memory", "", "card", None, "memory"),
        ("status", "", "card", None, "status"),
        ("usage", "", "card", None, "usage"),
        ("config", "", "card", None, "config"),
        ("help", "", "card", None, "help"),
        # Deferred + terminal-only
        ("yolo", "", "unsupported", None, None),
        ("reasoning", "", "unsupported", None, None),
        ("retry", "", "unsupported", None, None),
        ("copy", "", "unsupported", None, None),
        ("quit", "", "unsupported", None, None),
    ],
)
def test_exec_dispatch(tmp_path, command, arg, kind, action, card_type):
    result = _make_service(tmp_path).exec(session_id="s1", command=command, args=arg)
    assert result.kind == kind
    assert result.action == action
    assert result.card_type == card_type


def test_new_passes_title_through_as_message(tmp_path):
    result = _make_service(tmp_path).exec(session_id="s1", command="new", args="My Title")
    assert result.kind == "action"
    assert result.action == "new"
    assert result.message == "My Title"


def test_title_passes_name_through_as_message(tmp_path):
    result = _make_service(tmp_path).exec(session_id="s1", command="title", args="Renamed")
    assert result.action == "title"
    assert result.message == "Renamed"


def test_complete_slash_hides_unsupported_commands(tmp_path):
    svc = _make_service(tmp_path)
    suggested = {item.command for item in svc.complete_slash("")}
    # Deferred / terminal-only commands must not be suggested...
    assert "yolo" not in suggested
    assert "redraw" not in suggested
    assert not (suggested & set(_DEFERRED))
    assert not (suggested & set(_TERMINAL_ONLY))
    # ...but supported ones still are.
    assert "help" in suggested
    assert "tools" in suggested


def test_bare_model_renders_model_card(tmp_path):
    result = _make_service(tmp_path)._handle_model("", "s1")
    assert result.kind == "card"
    assert result.card_type == "model"


def test_unsupported_is_single_source_of_truth():
    """Catalog 'supported' flag derives from this union — guard against drift."""
    assert _UNSUPPORTED == _TERMINAL_ONLY | _DEFERRED


def test_emittable_actions_are_valid_actionnames():
    """Every action exec() can emit must be a member of the ActionName Literal."""
    valid = set(typing.get_args(ActionName))
    emittable = _SESSION_ACTIONS | set(_SESSION_ACTION_ALIASES.values())
    assert not (emittable - valid), f"Actions absent from ActionName: {emittable - valid}"


def test_emittable_card_types_are_valid_cardtypes():
    """Every card_type exec() can emit must be a member of the CardType Literal.

    Pydantic raises a ValidationError at runtime otherwise; this surfaces the
    drift (a command mapped to an unknown card_type) at test time instead.
    """
    valid = set(typing.get_args(CardType))
    emittable = set(_CARD_COMMANDS.values()) | set(_CLI_CARD.values()) | {"model", "notice"}
    assert not (emittable - valid), f"card_types absent from CardType: {emittable - valid}"


def test_complete_slash_browse_is_uncapped(tmp_path):
    """A bare '/' (empty query) lists every supported command, past the 30 cap."""
    svc = _make_service(tmp_path)
    browse = svc.complete_slash("")
    # The shared registry alone has >30 supported commands across categories.
    assert len(browse) > 30
    # A non-empty query stays capped.
    assert len(svc.complete_slash("s")) <= 30


def test_buckets_are_disjoint():
    buckets = {
        "session": _SESSION_ACTIONS,
        "session_alias": frozenset(_SESSION_ACTION_ALIASES),
        "card": frozenset(_CARD_COMMANDS),
        "cli_card": frozenset(_CLI_CARD),
        "deferred": _DEFERRED,
        "terminal": _TERMINAL_ONLY,
        "inline": _INLINE_HANDLED,
    }
    names = list(buckets.items())
    for i, (name_a, a) in enumerate(names):
        for name_b, b in names[i + 1 :]:
            overlap = a & b
            assert not overlap, f"{name_a} and {name_b} overlap: {overlap}"


def test_every_registry_command_is_categorized():
    """Drift guard: a newly-added registry command must be placed in a bucket.

    Without this, an uncategorized command would silently fall through to the
    'not available in Desktop yet' default and nobody would notice.
    """
    from hermes_cli.commands import COMMAND_REGISTRY

    covered = (
        _SESSION_ACTIONS
        | frozenset(_SESSION_ACTION_ALIASES)
        | frozenset(_CARD_COMMANDS)
        | frozenset(_CLI_CARD)
        | _DEFERRED
        | _TERMINAL_ONLY
        | _INLINE_HANDLED
    )
    uncategorized = [
        cmd.name
        for cmd in COMMAND_REGISTRY
        if not cmd.gateway_only
        and cmd.name not in _DESKTOP_HIDDEN
        and cmd.name not in covered
    ]
    assert not uncategorized, (
        f"Commands missing a Desktop bucket: {uncategorized}. Add each to a set "
        "in command_service.py (_SESSION_ACTIONS / _CARD_COMMANDS / _CLI_CARD / "
        "_DEFERRED / _TERMINAL_ONLY / _INLINE_HANDLED)."
    )
