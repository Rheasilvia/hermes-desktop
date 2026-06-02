# Desktop TUI Parity Todo Plan

Last updated: 2026-06-01

This plan ranks the missing Desktop capabilities against the current TUI by importance and urgency. Priority means product risk first: broken core chat flows and hidden failures outrank broader parity work.

## P0 - Important and Urgent

- [ ] Restore slash command discovery and execution in Desktop chat.
  - Implement `complete.slash`, `slash.exec`, and `command.dispatch` equivalents in `desktop_backend`, or route through a shared command service with the same command registry semantics as TUI.
  - Make `MessageInput` execute selected slash commands instead of sending them as plain prompts when appropriate.
  - Acceptance: `/help`, `/model`, `/sessions`, `/compress`, `/branch`, skill commands, and plugin/quick commands either work or return an explicit unsupported message.

- [ ] Wire file/image/context attachments into prompt execution.
  - Send `MessageInput` attachment chips through `prompt.execute` and add backend handling for file/image context, matching TUI `/image` and `@file/@folder/@url/@diff` behavior where feasible.
  - Add path completion support for context references.
  - Acceptance: attached files and images affect the next agent turn; unsupported attachment types fail visibly.

- [ ] Complete pending input surfaces: approval, clarify, sudo, and secret.
  - Add backend routes and frontend cards for `sudo.request` and `secret.request` alongside current approval/clarify handling.
  - Expand approval choices to support TUI-equivalent `once`, `session`, `always`, and `deny` when the backend provides those options.
  - Acceptance: dangerous command approvals, path approvals, sudo password prompts, secrets, and clarify prompts can all unblock a running turn from Desktop.

- [ ] Implement real branch, retry, and edit-resend flows.
  - Replace the placeholder Desktop `session.branch` implementation with a real branch from the selected session/history.
  - Implement message action handlers for retry and edit so they create a coherent new turn, not just UI state.
  - Acceptance: Branch creates a child session with inherited context; retry/edit produces a persisted turn without corrupting history.

- [ ] Fix session replay and live event routing gaps that can hide running work.
  - Track known session IDs from `session.list`, `resume`, and route activation, not only newly-created sessions.
  - Ensure reconnect replay dispatches only the active session to active chat handlers or includes session-aware routing in the store.
  - Acceptance: reconnect after backend restart does not drop or duplicate visible messages for current and recently viewed sessions.

## P1 - Important but Less Urgent

- [ ] Add Desktop live session manager parity.
  - Implement Desktop equivalents for TUI `session.active_list` and `session.activate`, exposing live status (`starting`, `working`, `waiting`, `idle`) and inflight turns.
  - Add UI for switching between live Desktop sessions without losing running work.
  - Acceptance: user can start one long task, switch to another session, and return to see the first task's live state.

- [ ] Broaden session history beyond Desktop-only source.
  - Add an all-sources session browser or filter so Desktop can resume CLI/TUI/gateway/ACP sessions, while still hiding internal `tool` sessions.
  - Preserve Desktop metadata defaults when resuming non-Desktop sessions.
  - Acceptance: Desktop can find and open recent human-facing sessions created outside Desktop.

- [ ] Support session-scoped model, personality, prompt, and compression operations.
  - Align Desktop's session model switch with TUI `/model --tui-session` behavior.
  - Add backend support for session-level personality/system prompt refresh and context compression.
  - Acceptance: changing model/personality/compression during a session updates the live agent safely and surfaces busy-session conflicts.

- [ ] Implement background prompt and process controls.
  - Add `prompt.background`, `background.complete`, `btw.complete`, and process stop/status support where Desktop already declares event types.
  - Acceptance: user can launch a background prompt, continue chatting, receive completion, and stop background processes from Desktop.

- [ ] Fill high-signal event parity.
  - Add handling for `status.update`, `session.info`, `reasoning.available`, gateway stderr/protocol errors, and tool progress variants that TUI already emits.
  - Acceptance: long-running tools and agent status transitions are visible without opening logs.

## P2 - Useful Parity and Polish

- [ ] Move management surfaces behind chat commands where users expect them.
  - Add chat-accessible command equivalents for common Desktop pages: model, skills, tools, memory, cron, gateway, and settings.
  - Acceptance: command palette or slash commands can deep-link to the relevant Desktop page or execute the backend action directly.

- [ ] Add TUI convenience operations that are not core chat blockers.
  - Evaluate Desktop support for `/voice`, `/browser`, `/reload-mcp`, `/reload`, `/status`, `/usage`, `/title`, `/save`, `/undo`, `/mouse`, `/details`, and `/compact`.
  - Implement only commands with clear Desktop UX value; return explicit unsupported messages for terminal-only commands.
  - Acceptance: common TUI muscle-memory commands do not silently fail in Desktop.

- [ ] Improve model picker parity.
  - Add inline provider credential save/disconnect flows comparable to TUI's model picker, reusing existing Desktop provider APIs.
  - Distinguish global default model changes from session-scoped model switches.
  - Acceptance: users can configure a missing API key and switch a session model without leaving the chat flow.

- [ ] Add subagent/spawn tree visibility if Desktop adopts delegation workflows.
  - Surface spawn tree status and subagent activity only after P0/P1 event routing is stable.
  - Acceptance: delegated work is inspectable from Desktop without rebuilding the primary chat transcript.

## Validation Checklist

- [ ] `cd desktop && npm run type-check`
- [ ] `cd desktop && npm run lint`
- [ ] `cd desktop && npm run test`
- [ ] `cd desktop/backend && uv run pytest`
- [ ] Manual: send a normal prompt, run a slash command, attach a file/image, approve a dangerous command, trigger clarify, interrupt, reconnect backend, and resume a non-Desktop session.

## Notes

- Do not rebuild the dashboard/TUI transcript in React; Desktop has its own chat surface, but dashboard `/chat` must remain PTY-backed TUI.
- Prefer shared Hermes command/config/session services over copying TUI-only logic into Desktop-specific branches.
- Keep unsupported commands explicit. Silent no-ops are worse than a clear limitation.
