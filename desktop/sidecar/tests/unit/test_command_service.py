"""Unit tests for CommandService dispatch (Desktop slash-command cards).

Covers the Desktop categorization buckets — lifecycle session actions, inline
cards (live-data + CLI-text), deferred, and terminal-only — plus the drift guard
that keeps every shared ``COMMAND_REGISTRY`` command accounted for in exactly one
bucket.
"""
from __future__ import annotations

import typing
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from daemon.schemas.commands import ActionName, CardType
from daemon.services.command_service import (
    _command_score,
    _fuzzy_score,
    _strip_ansi,
    _CARD_COMMANDS,
    _CLI_CARD,
    _DEFERRED,
    _DESKTOP_HIDDEN,
    _DESKTOP_TRIMMED,
    _DESKTOP_UNAVAILABLE,
    _INLINE_HANDLED,
    _PAGE_MANAGED,
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


class _SessionService:
    def __init__(self, cwd: str):
        self._cwd = cwd

    def get_session(self, session_id: str):
        return {"id": session_id, "cwd": self._cwd}


def _make_service_with_cwd(tmp_path, cwd) -> CommandService:
    return CommandService(
        hermes_home=tmp_path,
        session_service=_SessionService(str(cwd)),
        agent_pool=None,
    )


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
        # No inline-card commands remain — Desktop is trimmed to session lifecycle
        # + skills. /model (bare) is the only card, covered separately. status/
        # help/platforms/agents are now hidden (see the trimmed test).
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


@pytest.mark.parametrize("command", ["config", "browser", "voice"])
def test_config_commands_redirect_to_settings_page(tmp_path, command):
    """config/browser/voice are owned by the Settings page tabs — they no longer
    render a CLI output card; they redirect the user to the page."""
    result = _make_service(tmp_path).exec(session_id="s1", command=command, args="")
    assert result.kind == "unsupported"
    assert result.card_type is None
    assert "Settings" in result.message


def test_page_managed_commands_redirect(tmp_path):
    """Every page-superseded command is hidden from autocomplete and, if typed
    directly, returns a notice pointing at its owning page (no duplicate card)."""
    svc = _make_service(tmp_path)
    suggested = {item.command for item in svc.complete_slash("")}
    for name, page in _PAGE_MANAGED.items():
        assert name not in suggested, f"{name} should be hidden from autocomplete"
        result = svc.exec(session_id="s1", command=name, args="")
        assert result.kind == "unsupported"
        assert result.card_type is None
        assert page in result.message, f"{name} should point to the {page} page"


def test_strip_ansi_removes_escape_codes():
    """CLI colour codes must be stripped so the output card isn't garbled."""
    raw = "\x1b[1;31mUnknown command: /logs\x1b[0m\n\x1b[2;3mhi\x1b[0m"
    assert _strip_ansi(raw) == "Unknown command: /logs\nhi"


def test_trimmed_commands_hidden_from_autocomplete(tmp_path):
    """Low-value commands (cards + CLI passthroughs) are hidden from autocomplete
    and resolve to a clean 'not available' notice if typed directly."""
    svc = _make_service(tmp_path)
    suggested = {item.command for item in svc.complete_slash("")}
    for name in _DESKTOP_TRIMMED:
        assert name not in suggested, f"{name} should be hidden from autocomplete"
        result = svc.exec(session_id="s1", command=name, args="")
        assert result.kind == "unsupported"
        assert result.card_type is None


def test_unavailable_commands_hidden_from_autocomplete(tmp_path):
    """whoami exists upstream but has no Desktop handler — it must be hidden from
    suggestions and resolve to a clean 'not available' notice. (logs moved to
    _PAGE_MANAGED → Gateway page; covered by test_page_managed_commands_redirect.)"""
    svc = _make_service(tmp_path)
    suggested = {item.command for item in svc.complete_slash("")}
    assert "whoami" not in suggested
    result = svc.exec(session_id="s1", command="whoami", args="")
    assert result.kind == "unsupported"
    assert result.card_type is None


def test_complete_slash_hides_unsupported_commands(tmp_path):
    svc = _make_service(tmp_path)
    suggested = {item.command for item in svc.complete_slash("")}
    # Deferred / terminal-only commands must not be suggested...
    assert "yolo" not in suggested
    assert "redraw" not in suggested
    assert not (suggested & set(_DEFERRED))
    assert not (suggested & set(_TERMINAL_ONLY))
    # ...nor page-managed duplicates (sessions/tools/cron/…)...
    assert not (suggested & set(_PAGE_MANAGED))
    # ...nor trimmed low-value commands (status/help/insights/…).
    assert not (suggested & set(_DESKTOP_TRIMMED))
    # ...but supported session-lifecycle commands still are.
    assert "new" in suggested
    assert "resume" in suggested


def test_fuzzy_score_tiers():
    """exact > prefix > contiguous substring > subsequence > no-match."""
    assert _fuzzy_score("new", "new") > _fuzzy_score("new", "newish")        # exact > prefix
    assert _fuzzy_score("new", "newish") > _fuzzy_score("ew", "anew")        # prefix > substring
    assert _fuzzy_score("nw", "new") > float("-inf")                          # subsequence matches
    assert _fuzzy_score("xyz", "new") == float("-inf")                        # no match


def test_command_score_prioritises_name_over_description():
    """A name match always outranks a description-only (substring) match."""
    name_hit = _command_score("res", "resume", "irrelevant text")
    desc_hit = _command_score("res", "branch", "restore something")
    assert name_hit > desc_hit
    # A query that hits neither name nor description is dropped.
    assert _command_score("zzz", "branch", "create a branch") == float("-inf")


def test_complete_slash_ranks_name_matches_first(tmp_path):
    """A query matching a command NAME (prefix) leads over description-only hits."""
    svc = _make_service(tmp_path)
    ordered = [i.command for i in svc.complete_slash("/res")]
    assert "resume" in ordered, ordered
    assert ordered[0].startswith("res"), ordered[:5]


def test_unsupported_is_single_source_of_truth():
    """Catalog 'supported' flag derives from this union — guard against drift."""
    assert _UNSUPPORTED == _TERMINAL_ONLY | _DEFERRED | _DESKTOP_UNAVAILABLE | frozenset(_PAGE_MANAGED) | _DESKTOP_TRIMMED


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
    emittable = set(_CARD_COMMANDS.values()) | set(_CLI_CARD.values()) | {"notice"}
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
        "unavailable": _DESKTOP_UNAVAILABLE,
        "page_managed": frozenset(_PAGE_MANAGED),
        "trimmed": _DESKTOP_TRIMMED,
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
        | _DESKTOP_UNAVAILABLE
        | frozenset(_PAGE_MANAGED)
        | _DESKTOP_TRIMMED
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


def test_quick_exec_requires_session_id(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "hermes_cli.config.load_config",
        lambda: {"quick_commands": {"build": {"type": "exec", "command": "echo ok"}}},
    )

    result = _make_service(tmp_path).exec(session_id=None, command="build", args="")

    assert result.kind == "error"
    assert result.message == "SESSION_REQUIRED"


def test_quick_exec_fails_closed_when_sandbox_runner_unavailable(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setattr(
        "hermes_cli.config.load_config",
        lambda: {"quick_commands": {"build": {"type": "exec", "command": "echo ok"}}},
    )
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: None)

    result = _make_service_with_cwd(tmp_path, workspace).exec(
        session_id="s1",
        command="build",
        args="",
    )

    assert result.kind == "error"
    assert result.message == "SANDBOX_UNAVAILABLE"


def test_quick_exec_uses_sandbox_runner_without_shell_true(tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    runner = Mock()
    runner.run.return_value = SimpleNamespace(returncode=0, stdout="ok\n", stderr="")
    monkeypatch.setattr(
        "hermes_cli.config.load_config",
        lambda: {"quick_commands": {"build": {"type": "exec", "command": "echo ok"}}},
    )
    monkeypatch.setattr("daemon.services.sandbox_runner.get_sandbox_runner", lambda: runner)
    subprocess_run = Mock(side_effect=AssertionError("subprocess.run must not be called directly"))
    monkeypatch.setattr("daemon.services.command_service.subprocess.run", subprocess_run)

    result = _make_service_with_cwd(tmp_path, workspace).exec(
        session_id="s1",
        command="build",
        args="",
    )

    assert result.kind == "output"
    assert result.message == "ok"
    runner.run.assert_called_once()
    command = runner.run.call_args.kwargs["command"]
    assert command[:2] in (["/bin/sh", "-lc"], ["sh", "-lc"])
    assert runner.run.call_args.kwargs["workspace_root"] == str(workspace.resolve())
    subprocess_run.assert_not_called()


def test_plugin_commands_are_disabled_in_desktop(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "hermes_cli.plugins.get_plugin_command_handler",
        lambda name: (lambda arg: "ran"),
    )

    result = _make_service(tmp_path).exec(session_id="s1", command="plugin-cmd", args="")

    assert result.kind == "unsupported"
    assert result.message == "Plugin commands are not available in Desktop."
