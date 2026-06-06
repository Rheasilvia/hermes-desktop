from __future__ import annotations

import contextlib
import io
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from rich.console import Console

# Matches ANSI/VT escape sequences (CSI colour + cursor codes). NO_COLOR handles
# the CLI's Rich consoles at the source; this strips the residue from CLI paths
# that embed hardcoded \033[..m literals (which no env setting can suppress),
# so nothing renders as garbled "乱码" in the monospace output card.
_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


def _fuzzy_score(query: str, text: str) -> float:
    """Relevance of ``query`` against ``text`` (higher better; -inf = no match).
    Tiers: exact > prefix > contiguous substring > in-order subsequence."""
    q = query.lower().strip()
    t = text.lower()
    if not q:
        return 0.0
    if t == q:
        return 1000.0
    if t.startswith(q):
        return 800.0 - len(t)
    idx = t.find(q)
    if idx != -1:
        return 600.0 - idx - len(t) * 0.1
    qi = 0
    score = 0.0
    last = -2
    for i, ch in enumerate(t):
        if qi < len(q) and ch == q[qi]:
            score += 4 if i == last + 1 else 1  # contiguous chars worth more
            last = i
            qi += 1
    if qi != len(q):
        return float("-inf")
    return 300.0 + score - len(t) * 0.1


def _command_score(query: str, command: str, description: str) -> float:
    """Rank a command by NAME relevance first; fall back to a low-band *substring*
    match in the description so name matches always outrank description-only hits
    and scattered description letters don't pollute results."""
    name = _fuzzy_score(query, command)
    if name != float("-inf"):
        return name
    idx = description.lower().find(query.lower())
    return float("-inf") if idx == -1 else 100.0 - idx

from ..schemas.commands import CommandCatalogItem, CommandResult, SlashCompleteItem


# Commands hidden from the Desktop catalog entirely (gateway/messaging plumbing).
_DESKTOP_HIDDEN = frozenset({"sethome", "set-home", "commands", "approve", "deny", "start", "topic", "restart", "platform"})

# Commands handled inline by exec() with a built-in Desktop behavior (no card).
_INLINE_HANDLED = frozenset({"queue", "stop"})

# Lifecycle session commands → a frontend session action (create/branch/rename/
# resume). Read-only browse commands (sessions/history) are cards, not actions.
_SESSION_ACTIONS = frozenset({"new", "branch", "resume", "title"})

# Commands whose Desktop behavior maps onto a session action (command → action).
# /clear's TUI purpose is "clear screen and start a new session" — the screen-clear
# has no Desktop meaning, so it resolves to the same fresh-session action as /new.
_SESSION_ACTION_ALIASES: dict[str, str] = {"clear": "new"}

# Commands that render an inline card in the command-card dock from live
# gateway/store data (command → card_type). The frontend card fetches via the
# same gateway/store method the corresponding page uses; the backend only emits
# the card_type (thin dispatcher, no data assembly here). Commands whose data is
# already owned by a dedicated management page live in _PAGE_MANAGED instead.
_CARD_COMMANDS: dict[str, str] = {}

# CLI-only commands with no structured gateway source: run the headless
# HermesCLI, capture its text, and render it inside an output-style card
# (command → card_type). Currently empty — the CLI passthrough commands were
# trimmed (see _DESKTOP_TRIMMED). The _run_cli_command bridge below is kept so a
# command can be re-enabled here with a one-line map entry.
_CLI_CARD: dict[str, str] = {}

# Commands superseded by a dedicated Desktop management page. Hidden from
# autocomplete; typing one directly points the user at the owning page instead
# of rendering a duplicate inline card (command → human page label).
_PAGE_MANAGED: dict[str, str] = {
    "sessions": "Sessions", "history": "Sessions",
    "tools": "Skills", "toolsets": "Skills",
    "skills": "Skills", "bundles": "Skills",
    "cron": "Cron",
    "plugins": "Plugins",
    "memory": "Memory",
    "usage": "Model", "model": "Model",
    "config": "Settings", "browser": "Settings", "voice": "Settings",
    "logs": "Gateway",
}

# Live-turn + stateful-toggle commands that can't safely use the throwaway CLI
# instance yet — surfaced with an explicit "not available" message.
_DEFERRED = frozenset({
    "retry", "steer", "goal", "subgoal", "undo", "background", "compress",
    "compact", "yolo", "fast", "reasoning", "personality", "verbose",
    "footer", "codex-runtime", "reload", "reload-mcp", "reload-skills",
})

# Terminal/TUI-only commands with no Desktop equivalent.
_TERMINAL_ONLY = frozenset({
    "redraw", "statusbar", "skin", "indicator", "busy", "mouse",
    "copy", "paste", "image", "quit", "exit", "details", "handoff", "snapshot",
})

# Registry/TUI commands that exist upstream but have no working Desktop
# implementation (no headless CLI slash handler). Hidden from autocomplete and
# surfaced as "not available" if typed directly.
_DESKTOP_UNAVAILABLE = frozenset({"whoami"})

# Commands intentionally not surfaced in Desktop — low value vs the StatusBar,
# the ⌘K command palette, or dedicated pages. Hidden from autocomplete; a direct
# invocation returns a "not available" notice. Desktop keeps the autocomplete
# focused on session lifecycle commands + skills.
_DESKTOP_TRIMMED = frozenset({
    "status", "help", "platforms", "agents",
    "profile", "gquota", "insights", "debug", "save",
    "rollback", "curator", "kanban", "update",
})

# Catalog/help "supported" flag derives from this union — single source of truth,
# so the catalog can't drift from the dispatch buckets.
_UNSUPPORTED = _TERMINAL_ONLY | _DEFERRED | _DESKTOP_UNAVAILABLE | frozenset(_PAGE_MANAGED) | _DESKTOP_TRIMMED
_TUI_EXTRA = (
    ("compact", "Toggle compact display mode", "TUI"),
    ("details", "Control agent detail visibility", "TUI"),
    ("mouse", "Set mouse tracking preset [on|off|toggle|wheel|buttons|all]", "TUI"),
)

# Max autocomplete suggestions for a non-empty query. Browse mode (empty query,
# i.e. a bare "/") is uncapped so the panel can list every available command.
_SLASH_COMPLETE_LIMIT = 30


class CommandService:
    def __init__(self, *, hermes_home: Path, session_service: Any, agent_pool: Any) -> None:
        self._hermes_home = hermes_home
        self._session_service = session_service
        self._agent_pool = agent_pool

    def catalog(self) -> dict[str, Any]:
        from hermes_cli.commands import COMMAND_REGISTRY, _build_description

        items: list[CommandCatalogItem] = []
        for cmd in COMMAND_REGISTRY:
            if cmd.name in _DESKTOP_HIDDEN or cmd.gateway_only:
                continue
            items.append(CommandCatalogItem(
                command=cmd.name,
                description=_build_description(cmd),
                category=cmd.category,
                aliases=list(cmd.aliases),
                args_hint=cmd.args_hint,
                source="registry",
                supported=cmd.name not in _UNSUPPORTED,
            ))

        for name, desc, category in _TUI_EXTRA:
            items.append(CommandCatalogItem(
                command=name,
                description=desc,
                category=category,
                source="tui",
                supported=name not in _UNSUPPORTED,
            ))

        try:
            from agent.skill_bundles import get_skill_bundles
            for key, info in sorted(get_skill_bundles().items()):
                items.append(CommandCatalogItem(
                    command=key.lstrip("/"),
                    description=str(info.get("description") or "Skill bundle"),
                    category="Skills",
                    source="skill_bundle",
                    supported=True,
                    icon="zap",
                ))
        except Exception:
            pass

        try:
            from agent.skill_commands import scan_skill_commands
            for key, info in sorted(scan_skill_commands().items()):
                items.append(CommandCatalogItem(
                    command=key.lstrip("/"),
                    description=str(info.get("description") or "Skill command"),
                    category="Skills",
                    source="skill",
                    supported=True,
                    icon="zap",
                ))
        except Exception:
            pass

        try:
            from hermes_cli.config import load_config
            qcmds = load_config().get("quick_commands", {}) or {}
            if isinstance(qcmds, dict):
                for name, qc in sorted(qcmds.items()):
                    if not isinstance(qc, dict):
                        continue
                    desc = str(qc.get("description") or qc.get("type") or "quick command")
                    items.append(CommandCatalogItem(
                        command=name,
                        description=desc,
                        category="User commands",
                        source="quick_command",
                        supported=True,
                    ))
        except Exception:
            pass

        return {"items": [i.model_dump() for i in items]}

    def complete_slash(self, partial: str) -> list[SlashCompleteItem]:
        text = partial if partial.startswith("/") else f"/{partial.lstrip('/')}"
        query = text[1:].lower().strip()
        # Browse mode (empty query) is uncapped so a bare "/" lists everything.
        limit = None if not query else _SLASH_COMPLETE_LIMIT
        seen: set[str] = set()
        scored: list[tuple[float, SlashCompleteItem]] = []

        for raw in self.catalog()["items"]:
            command = str(raw.get("command") or "")
            if not command or command in seen:
                continue
            # Don't suggest commands that aren't usable in Desktop — typing one
            # directly still returns an explicit "not available" message.
            if not raw.get("supported", True):
                continue
            description = str(raw.get("description") or "")
            if query:
                score = _command_score(query, command, description)
                if score == float("-inf"):
                    continue
            else:
                score = 0.0
            seen.add(command)
            scored.append((score, SlashCompleteItem(
                command=command,
                description=description,
                category=raw.get("category") or None,
                icon=raw.get("icon") or None,
            )))

        # Rank best-first for a query; browse mode keeps catalog/category order
        # (Python's sort is stable, so equal scores preserve insertion order).
        if query:
            scored.sort(key=lambda pair: pair[0], reverse=True)
        items = [item for _, item in scored]
        return items[:limit] if limit is not None else items

    def exec(self, *, session_id: str | None, command: str, args: str | None = None, raw: str | None = None) -> CommandResult:
        name, arg = self._parse(command=command, args=args, raw=raw)
        if not name:
            return CommandResult(kind="error", message="empty command")

        name = self._resolve_name(name)

        if name in {"queue", "q"}:
            if not arg:
                return CommandResult(kind="error", message="usage: /queue <prompt>")
            return CommandResult(kind="send", message=arg)

        # Lifecycle session commands (and aliases like /clear) → frontend action.
        action = _SESSION_ACTION_ALIASES.get(name)
        if action is None and name in _SESSION_ACTIONS:
            action = name
        if action is not None:
            return CommandResult(kind="action", action=action, message=arg)

        # Commands superseded by a dedicated management page — point the user
        # there instead of rendering a duplicate inline card.
        page = _PAGE_MANAGED.get(name)
        if page:
            return CommandResult(kind="unsupported", message=f"/{name} is managed in the {page} page.")

        # Commands that render an inline card from live gateway/store data.
        card_type = _CARD_COMMANDS.get(name)
        if card_type:
            return CommandResult(kind="card", card_type=card_type)

        # CLI-only commands: capture the CLI text and wrap it in a card. If the
        # CLI couldn't handle the command (unknown/unavailable), surface that as
        # a notice instead of dumping the raw error into an output card.
        cli_card = _CLI_CARD.get(name)
        if cli_card:
            result = self._run_cli_command(name, arg, session_id)
            if result.kind != "output":
                return result
            return CommandResult(kind="card", card_type=cli_card, message=result.message)

        if name in _DEFERRED or name in _DESKTOP_UNAVAILABLE:
            return CommandResult(kind="unsupported", message=f"/{name} is not available in Desktop yet.")
        if name in _DESKTOP_TRIMMED:
            return CommandResult(kind="unsupported", message=f"/{name} is not available in Desktop.")
        if name in _TERMINAL_ONLY:
            return CommandResult(kind="unsupported", message=f"/{name} is a terminal-only command in Desktop.")

        # Dynamic commands (not in the static registry): user quick commands,
        # plugin commands, and skill / skill-bundle invocations.
        quick = self._handle_quick_command(name, arg, session_id)
        if quick is not None:
            return quick

        plugin = self._handle_plugin_command(name, arg)
        if plugin is not None:
            return plugin

        skill = self._handle_skill_command(name, arg, session_id)
        if skill is not None:
            return skill

        bundle = self._handle_skill_bundle(name, arg, session_id)
        if bundle is not None:
            return bundle

        if name == "stop":
            try:
                from tools.process_registry import process_registry
                process_registry.kill_all()
                return CommandResult(kind="output", message="Stopped registered background processes.")
            except Exception as exc:
                return CommandResult(kind="error", message=f"Failed to stop processes: {exc}")

        # Safe default: any command not explicitly categorized — including a
        # newly-added registry entry that nobody mapped for Desktop — is
        # surfaced explicitly instead of being silently run via the CLI.
        return CommandResult(kind="unsupported", message=f"/{name} is not available in Desktop yet.")

    def _parse(self, *, command: str, args: str | None, raw: str | None) -> tuple[str, str]:
        text = (raw or command or "").strip()
        if text.startswith("/"):
            text = text[1:]
        if args is not None and command and " " not in command.strip().lstrip("/"):
            return command.strip().lstrip("/").lower(), args.strip()
        parts = text.split(maxsplit=1)
        return (parts[0].lower(), parts[1].strip() if len(parts) > 1 else "")

    def _resolve_name(self, name: str) -> str:
        try:
            from hermes_cli.commands import resolve_command
            resolved = resolve_command(name)
            return resolved.name if resolved else name
        except Exception:
            return name

    def _handle_quick_command(self, name: str, arg: str, session_id: str | None) -> CommandResult | None:
        try:
            from hermes_cli.config import load_config
            qcmds = load_config().get("quick_commands", {}) or {}
        except Exception:
            return None
        if name not in qcmds or not isinstance(qcmds.get(name), dict):
            return None
        qc = qcmds[name]
        if qc.get("type") == "alias":
            target = str(qc.get("target") or "").strip()
            if not target:
                return CommandResult(kind="error", message=f"Quick command /{name} has no target.")
            return self.exec(session_id=session_id, command=f"{target} {arg}".strip())
        if qc.get("type") == "exec":
            try:
                result = subprocess.run(str(qc.get("command") or ""), shell=True, capture_output=True, text=True, timeout=30)
            except Exception as exc:
                return CommandResult(kind="error", message=f"Quick command error: {exc}")
            output = "\n".join(p for p in [result.stdout, result.stderr] if p).strip()
            if result.returncode != 0:
                return CommandResult(kind="error", message=output or f"Quick command failed with exit code {result.returncode}")
            return CommandResult(kind="output", message=output or "Command returned no output.")
        return CommandResult(kind="unsupported", message=f"Quick command /{name} has unsupported type.")

    def _handle_plugin_command(self, name: str, arg: str) -> CommandResult | None:
        try:
            from hermes_cli.plugins import get_plugin_command_handler, resolve_plugin_command_result
            handler = get_plugin_command_handler(name)
            if not handler:
                return None
            result = resolve_plugin_command_result(handler(arg))
            return CommandResult(kind="output", message=str(result or "Command returned no output."))
        except Exception:
            return None

    def _handle_skill_command(self, name: str, arg: str, session_id: str | None) -> CommandResult | None:
        try:
            from agent.skill_commands import build_skill_invocation_message, scan_skill_commands
            key = f"/{name}"
            cmds = scan_skill_commands()
            if key not in cmds:
                return None
            msg = build_skill_invocation_message(key, arg, task_id=session_id or "")
            if not msg:
                return CommandResult(kind="error", message=f"Failed to load skill for /{name}.")
            return CommandResult(kind="skill", message=msg, name=str(cmds[key].get("name") or name))
        except Exception as exc:
            return CommandResult(kind="error", message=f"Skill command failed: {exc}")

    def _handle_skill_bundle(self, name: str, arg: str, session_id: str | None) -> CommandResult | None:
        try:
            from agent.skill_bundles import build_bundle_invocation_message, get_skill_bundles
            key = f"/{name}"
            bundles = get_skill_bundles()
            if key not in bundles:
                return None
            result = build_bundle_invocation_message(key, arg, task_id=session_id or "")
            if not result:
                return CommandResult(kind="error", message=f"Failed to load bundle for /{name}.")
            msg, loaded_names, missing = result
            suffix = f"\n\nSkipped missing skills: {', '.join(missing)}" if missing else ""
            return CommandResult(kind="skill", message=msg + suffix, name=", ".join(loaded_names))
        except Exception as exc:
            return CommandResult(kind="error", message=f"Skill bundle failed: {exc}")

    def _run_cli_command(self, name: str, arg: str, session_id: str | None) -> CommandResult:
        try:
            import cli as cli_mod
            from cli import HermesCLI
        except Exception as exc:
            return CommandResult(kind="unsupported", message=f"/{name} is unavailable in Desktop: {exc}")

        command = f"/{name} {arg}".strip()
        # NO_COLOR/TERM suppress colour at the source for the CLI's Rich consoles
        # (the proper fix); HERMES_HOME/SESSION_KEY scope the throwaway CLI to
        # this session. Saved and restored so we don't leak into the process env.
        overrides = {
            "HERMES_HOME": str(self._hermes_home),
            "NO_COLOR": "1",
            "TERM": "dumb",
        }
        if session_id:
            overrides["HERMES_SESSION_KEY"] = session_id
        saved_env = {k: os.environ.get(k) for k in overrides}
        os.environ.update(overrides)
        buf = io.StringIO()
        old_cprint = getattr(cli_mod, "_cprint", None)
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                cli = HermesCLI(compact=True, resume=session_id, verbose=False)
            # Narrower width than a real terminal so Rich tables/panels fit the
            # command-card dock without wrapping mid-row.
            cli.console = Console(file=buf, force_terminal=False, width=80)
            if old_cprint is not None:
                cli_mod._cprint = lambda text: print(text)
            with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(buf):
                cli.process_command(command)
            # Safety net for the few CLI paths that embed hardcoded ANSI literals
            # (e.g. the "Unknown command" line) which NO_COLOR can't reach.
            output = _strip_ansi(buf.getvalue()).strip()
            if output.lower().startswith("unknown command"):
                return CommandResult(kind="unsupported", message=f"/{name} is not available in Desktop yet.")
            return CommandResult(kind="output", message=output or "Command completed.")
        except Exception as exc:
            return CommandResult(kind="error", message=f"Command failed: {exc}")
        finally:
            if old_cprint is not None:
                cli_mod._cprint = old_cprint
            for key, prev in saved_env.items():
                if prev is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = prev

    def _help_text(self) -> str:
        lines = ["Available slash commands:"]
        for item in self.catalog()["items"]:
            supported = "" if item.get("supported") else " (not available in Desktop)"
            lines.append(f"/{item['command']} - {item.get('description', '')}{supported}")
        return "\n".join(lines)

    def _status_text(self, session_id: str | None) -> str:
        if not session_id:
            return "No active Desktop session."
        session = self._session_service.get_session(session_id)
        if not session:
            return "Session not found."
        return "\n".join([
            f"Session: {session_id}",
            f"Title: {session.get('title') or 'Untitled'}",
            f"Model: {session.get('provider') or 'unknown'}/{session.get('model') or 'unknown'}",
            f"Messages: {session.get('message_count') or 0}",
            f"CWD: {session.get('cwd') or ''}",
        ])
