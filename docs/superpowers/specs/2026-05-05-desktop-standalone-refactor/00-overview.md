# 00 — Overview

## Background

Hermes Desktop (`desktop/`) is a Tauri v2 + SolidJS application that currently
gets its data from `MockGatewayAdapter` and from a stdio JSON-RPC connection to
the upstream `tui_gateway` Python module. Two structural problems have surfaced:

1. **Upstream coupling.** Reusing `tui_gateway` and importing upstream Python
   modules (`hermes_cli/*`, `cron/*`, `agent/*`) means every refactor on the
   main branch produces merge conflicts in desktop. Desktop cannot evolve at
   its own pace.
2. **Mock data, not real data.** The Model and Cron pages display fixtures
   hard-coded in the frontend. The real `~/.hermes/cron/jobs.json` and the real
   model catalog are not surfaced.

This spec defines a refactor that makes desktop **fully self-contained** for
the Model Config and Cron features, while keeping its current UI/UX intact.

## Problem statement

> Refactor desktop's Model Config + Cron pages so that
> (a) they display real data from `~/.hermes/`,
> (b) desktop has zero runtime dependency on `tui_gateway` or any upstream
>     Python module,
> (c) UI/UX is preserved (no visual or interaction changes), and
> (d) the architecture leaves room for desktop-private configuration that
>     the CLI and other clients do not share.

## Goals (in scope for this refactor)

- Replace mock data on **Model** and **Cron** pages with real data sourced via
  a desktop-owned Python sidecar.
- Introduce a **three-layer configuration model** (shared business data /
  desktop overlay / desktop-only) backed by `~/.hermes/desktop/`.
- Introduce a **frontend `services/api/`** with a router that becomes the
  single data egress point for stores.
- Wire the Tauri Rust layer to **spawn, health-check, and supervise** the
  sidecar.
- Establish the **packaging path** that supports macOS single-authorization
  release builds (PyInstaller `--onedir` + Tauri `externalBin`).
- Preserve the existing chat / sessions stdio gateway path; this refactor
  does **not** touch chat/streaming functionality.

## Non-goals (explicitly out of scope)

- ❌ Implementing **create / edit / delete** for cron jobs in desktop.
  Sidecar exposes only **GET** for Layer 1 data.
- ❌ Implementing model OAuth flow / API-key entry in desktop.
- ❌ Replacing the existing `services/gateway/` stdio transport for chat,
  sessions, prompts, tool-calls, etc. That path stays.
- ❌ Modifying any upstream code (`hermes_cli/`, `cron/`, `agent/`,
  `tui_gateway/`, `web/`). Snapshots are **copied**, never imported.
- ❌ Building a release pipeline / signing automation. This spec defines
  the target shape; CI work is separate.
- ❌ Multi-instance / multi-window of desktop. Single-instance lock stays.
- ❌ Cross-device sync of `~/.hermes/desktop/`.
- ❌ Migrating existing `MockGatewayAdapter` users (chat, sessions). It
  stays in place for those modules.

## Glossary

| Term | Meaning |
|---|---|
| **Sidecar** | The desktop-private Python child process that runs FastAPI on `127.0.0.1` and serves `/desktop/api/*`. |
| **Layer 1 (shared business)** | Read-only data owned by upstream/CLI: `~/.hermes/cron/jobs.json`, `~/.hermes/cache/model_catalog.json`, etc. |
| **Layer 2 (desktop overlay)** | Per-entity UI metadata desktop attaches to Layer 1 entities: `~/.hermes/desktop/overlays/<domain>.json`. Indexed by entity ID. |
| **Layer 3 (desktop-only)** | Pure desktop UI/UX configuration with no upstream counterpart: `~/.hermes/desktop/{settings,state}.json`. |
| **Reader** | Sidecar module that parses a Layer 1 file. Stateless, read-only. |
| **Overlay loader** | Sidecar module that reads/writes a Layer 2 file. |
| **Merger** | Sidecar module that combines a Layer 1 entity list with Layer 2 metadata into a single response object. |
| **Router (frontend)** | `services/api/router.ts`. Maps semantic domain calls (`api.cron.jobs.list()`) to transport implementations. |
| **Transport (frontend)** | An implementation of an api domain: HTTP (sidecar), mock (in-memory), or gateway (wraps `services/gateway/`). |
| **HERMES_HOME** | The shared Hermes data root, default `~/.hermes/`. |
| **DESKTOP_HOME** | `${HERMES_HOME}/desktop/`. Owned exclusively by desktop. |

## Decision log

Each numbered item is a binding architectural decision. Implementing agents
**must not change** these without revising this spec.

### D1. Desktop owns its own Python sidecar (not `tui_gateway`, not the web FastAPI server)

- **Chosen.** Desktop spawns its own Python child process (`desktop_backend`)
  located at `desktop/backend/`.
- **Rejected: reuse `tui_gateway`.** Causes ongoing upstream coupling — the
  exact problem this refactor exists to solve.
- **Rejected: reuse the web FastAPI in `hermes_cli/web_server.py`.** Still
  upstream code, just a different file. Same coupling problem.
- **Rejected: native Rust commands reading `~/.hermes/` directly.** Would
  require porting `model_catalog` parsing logic to Rust, raising drift risk
  and CI complexity for marginal benefit.

### D2. Wire protocol = local HTTP (FastAPI) on `127.0.0.1` with dynamic port and Bearer token

- **Chosen.** OS-assigned port (`uvicorn(host="127.0.0.1", port=0)`), token
  written to a file with mode `0600` (not passed via argv, to avoid `ps`
  leakage), CORS limited to `tauri://localhost`.
- **Rejected: stdio JSON-RPC.** Awkward for request/response CRUD; less
  debuggable; would re-derive its own RPC schema.
- **Rejected: fixed port.** Risks collision with `hermes dashboard` (9119)
  and other local services.
- **Rejected: Tauri "sidecar" binary as the only mode.** Fine for release
  but adds packaging complexity. We use it for release packaging only;
  see D4.

### D3. Transport namespacing: routes are prefixed with `/desktop/api/...`

- Even though path shape mirrors web's `/api/...`, the `/desktop/` prefix
  prevents collision if both servers ever run on the same machine and makes
  desktop's API surface explicit on the wire.

### D4. Packaging = two-stage (dev = system Python, release = PyInstaller `--onedir` + Tauri `externalBin`)

- **Chosen.** Dev mode (`npm run tauri:dev`) spawns
  `python3 -m desktop_backend` for fast iteration. Release builds embed a
  PyInstaller `--onedir` binary into `Hermes Desktop.app/Contents/Resources/`
  and co-sign it with the main app for a single Gatekeeper authorization.
- **Rejected: system Python in release.** Would cause Gatekeeper to block
  the unsigned `python3` child or require users to install Python.
- **Rejected: PyInstaller `--onefile`.** Runtime extraction to `/tmp`
  invalidates code signature on macOS.
- **Rejected: `python-build-standalone` embed.** Larger sign/notarize
  surface than PyInstaller for negligible benefit at our scale.

### D5. Three-layer configuration model

- **Layer 1** (shared, read-only) lives at `~/.hermes/{cron,cache,...}/`.
- **Layer 2** (desktop overlay, read/write) lives at
  `~/.hermes/desktop/overlays/<domain>.json`. Indexed by entity ID.
- **Layer 3** (desktop-only, read/write) lives at
  `~/.hermes/desktop/{settings,state}.json`.
- **Hard invariant: Layer 2 corruption / failure must never block Layer 1.**
  If overlay can't be parsed, sidecar backs it up, returns Layer 1 with
  default-empty overlay, and the request still succeeds.

### D6. Sidecar imports nothing from upstream Python packages

- Reader modules under `desktop_backend/readers/` are **physical copies**
  of the minimal logic needed (parsing + validation + cache reading), with
  every upstream dependency stripped. Each copied module begins with a
  snapshot header recording: source path, upstream git SHA, copy date,
  and re-sync trigger conditions.
- This is the trade enforcing decision D1: copy over coupling.

### D7. Frontend has a single data egress point: `@/services/api`

- Stores never import `services/gateway/*` directly. They never construct
  `fetch` calls directly. They call `api.<domain>.<method>()`.
- A `router.ts` registry maps each domain method to a transport
  implementation (HTTP, mock, gateway). Switching transports for a
  domain is a single registry edit; consumers see no change.
- ESLint enforces this with `no-restricted-imports`.

### D8. Schema namespacing: shared fields and overlay fields never collide

- Every merged response object exposes Layer 1 fields at the top level
  (`job.id`, `job.schedule`) and Layer 2 fields nested under a fixed
  `desktop` key (`job.desktop.pinned`).
- Frontend code can statically tell whether a field is shared (and thus
  read-only-from-desktop) or private (and thus mutable).

### D9. Write scope this iteration

- ✅ Sidecar may **write** Layer 2 (`PATCH /desktop/api/overlays/...`) and
  Layer 3 (`PUT /desktop/api/settings`, `/state`).
- ❌ Sidecar **never writes** Layer 1. Cron job creation, edit, delete,
  pause/resume/trigger are out of scope for this refactor.

### D10. UI/UX is preserved

- Module components under `desktop/src/modules/model/` and
  `desktop/src/modules/cron/` are not redesigned. The change is in the data
  source, not in markup or interaction. CSS modules and existing layout
  components stay.
- The single allowed UI change is removing inline mock data from view
  components (e.g. `CronView.tsx`) and reading from the new store instead.

## Snapshot provenance

This spec was authored against the following repository state:

- Branch: `feat/desktop-standalone`
- HEAD: `69e4387e527e45fcd715dab02e4c3857872e1641`
- Date: 2026-05-05

When implementing agents copy upstream Python modules into
`desktop_backend/readers/`, they must record the **then-current** upstream
git SHA in each copied file's snapshot header (see D6). The SHA above is
the correct one to use for the initial copy.

## Reading order for implementing agents

1. This file (`00-overview.md`) — read first; understand decisions.
2. `01-architecture.md` — file tree and component responsibilities.
3. `02-data-flow.md` — startup, request/response, write flows.
4. `03-error-handling.md` — failure modes and the recovery contract.
5. `04-testing.md` — what to test and at what layer.
6. `05-implementation-notes.md` — onboarding, build commands, scope reminders,
   acceptance criteria, "definitely don't" list.
