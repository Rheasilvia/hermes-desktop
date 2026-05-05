# Desktop Standalone Refactor — Spec

> Date: 2026-05-05
> Branch: `feat/desktop-standalone`
> Snapshot SHA: `69e4387e527e45fcd715dab02e4c3857872e1641`

## What this spec is

A binding architectural plan for refactoring the Hermes Desktop app's
**Model Config** and **Cron** features so that:

- They display real data from `~/.hermes/` instead of frontend mocks.
- Desktop has zero runtime dependency on `tui_gateway` or any other
  upstream Python module.
- The existing UI/UX is preserved byte-for-byte.
- The architecture supports desktop-private configuration that the CLI
  and other clients do not share.

The spec is **persisted** (committed to the repo) so it can be handed
off to implementing agents in fresh sessions.

## How to use this spec

Read in order:

1. [`00-overview.md`](./00-overview.md) — background, goals, non-goals,
   glossary, **decision log (D1–D10)**, snapshot provenance.
2. [`01-architecture.md`](./01-architecture.md) — process model, file
   tree, component responsibilities, public API surface, boundary rules.
3. [`02-data-flow.md`](./02-data-flow.md) — startup, read flow, write
   flow, atomic write contract, lock contract, shutdown.
4. [`03-error-handling.md`](./03-error-handling.md) — error envelope,
   error code table, recovery procedures, logging contract.
5. [`04-testing.md`](./04-testing.md) — test layers, required tests,
   coverage targets, what we deliberately do NOT test.
6. [`05-implementation-notes.md`](./05-implementation-notes.md) —
   implementation order, build commands, snapshot header template,
   acceptance criteria, **definitely-don't list**.

## TL;DR for implementing agents

- Build a **Python sidecar** at `desktop/backend/desktop_backend/`
  serving `/desktop/api/*` on `127.0.0.1:<dynamic-port>` with a
  Bearer token from a `0600` file.
- Tauri's `sidecar.rs` spawns it, parses `READY <port>` from stdout,
  and supervises it.
- Sidecar **copies** (not imports) the minimal upstream parsing logic
  into `desktop_backend/readers/` with a snapshot header recording
  source path, upstream SHA, and copy date.
- Three-layer config:
  - **L1** = `~/.hermes/{cron,cache}/...` (read-only).
  - **L2** = `~/.hermes/desktop/overlays/<domain>.json` (UI metadata).
  - **L3** = `~/.hermes/desktop/{settings,state}.json` (desktop only).
- Frontend gets a single egress at `@/services/api` with a `router.ts`
  that maps domains to transports (http / mock / gateway). Stores
  never call `fetch` and never import `services/gateway/*` for
  Model/Cron concerns. ESLint enforces.
- Schema namespacing: shared L1 fields at top level, overlay fields
  under `desktop` key.
- L2 corruption never blocks L1. L1 is never auto-modified.
- Write scope this iteration: **L2 PATCH + L3 PUT only**. No cron
  create/edit/delete. No model OAuth flow.
- Packaging: dev = system Python; release = PyInstaller `--onedir`
  embedded as Tauri `externalBin`, co-signed with the `.app` for
  single Gatekeeper authorization.
- UI is **not** redesigned. Only the data source changes.

## Decision summary (from 00-overview.md)

| # | Decision |
|---|---|
| D1 | Desktop owns its own Python sidecar (`desktop_backend`) |
| D2 | Local HTTP on 127.0.0.1, dynamic port, Bearer token in 0600 file |
| D3 | Routes prefixed `/desktop/api/...` |
| D4 | PyInstaller `--onedir` + Tauri `externalBin` for release |
| D5 | Three-layer config (L1 shared / L2 overlay / L3 desktop-only) |
| D6 | Sidecar imports nothing from upstream — copies with snapshot header |
| D7 | Frontend single egress: `@/services/api` with router.ts |
| D8 | Schema namespacing: shared at top, overlay under `desktop` key |
| D9 | Write scope: L2 PATCH + L3 PUT only; no L1 writes |
| D10 | UI/UX preserved; only data source changes |

## Status

- [x] Spec authored
- [ ] Spec reviewed by user
- [ ] Implementation plan written (`writing-plans` skill output)
- [ ] Implementation in progress
- [ ] Acceptance criteria met
