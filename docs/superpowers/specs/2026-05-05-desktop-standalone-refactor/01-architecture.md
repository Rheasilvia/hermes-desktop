# 01 — Architecture

## High-level diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Hermes Desktop.app                            │
│                                                                      │
│  ┌────────────────────────────┐      ┌─────────────────────────────┐ │
│  │   Tauri WebView (SolidJS)  │      │  Tauri Rust (src-tauri/)    │ │
│  │                            │      │                             │ │
│  │  pages/  modules/  stores/ │      │  main.rs                    │ │
│  │           │                │      │  sidecar.rs  (NEW)          │ │
│  │           ▼                │      │  commands/fs.rs             │ │
│  │  services/api/  (NEW)      │◀────▶│                             │ │
│  │   - router.ts              │ IPC  │                             │ │
│  │   - transports/http        │      │                             │ │
│  │   - transports/mock        │      │                             │ │
│  │   - transports/gateway ────┼──┐   │                             │ │
│  │                            │  │   │   spawns ────────┐          │ │
│  │  services/gateway/         │  │   │                  │          │ │
│  │   (chat/sessions stdio,    │◀─┘   │                  │          │ │
│  │    UNCHANGED)              │      │                  │          │ │
│  └────────────────────────────┘      └──────────────────┼──────────┘ │
│            │                                            │            │
│            │ HTTP (127.0.0.1:<dyn>, Bearer token)       │            │
│            ▼                                            ▼            │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │   desktop_backend (Python sidecar, NEW)                         │ │
│  │                                                                 │ │
│  │   FastAPI app  /desktop/api/...                                 │ │
│  │     ├─ routers/  (cron, model, settings, state, overlays)       │ │
│  │     ├─ services/ (merger)                                       │ │
│  │     ├─ readers/  (Layer 1, copies of upstream)                  │ │
│  │     ├─ overlays/ (Layer 2 loader/writer)                        │ │
│  │     └─ store/    (Layer 3 loader/writer)                        │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│            │                                                         │
└────────────┼─────────────────────────────────────────────────────────┘
             │ filesystem
             ▼
   ┌──────────────────────────────────────────┐
   │ ~/.hermes/                               │
   │  ├─ cron/jobs.json          (Layer 1, R) │
   │  ├─ cache/model_catalog.json (Layer 1,R) │
   │  └─ desktop/                (Layer 2+3)  │
   │       ├─ overlays/                       │
   │       │    ├─ cron.json     (Layer 2)    │
   │       │    └─ model.json    (Layer 2)    │
   │       ├─ settings.json      (Layer 3)    │
   │       └─ state.json         (Layer 3)    │
   └──────────────────────────────────────────┘
```

## Process model

| Process | Lifetime | Owner | Responsibilities |
|---|---|---|---|
| Tauri main (Rust) | App lifetime | Rust `main.rs` | Window management, single-instance lock, spawn/supervise sidecar, expose IPC commands |
| WebView (SolidJS) | App lifetime | Tauri | Renders UI, holds frontend state, talks to sidecar over HTTP |
| `desktop_backend` (Python) | Child of Tauri main | `sidecar.rs` | Serves `/desktop/api/*` on `127.0.0.1:<dynamic>` |
| `tui_gateway` (Python, existing) | Child of Tauri main (existing path) | `services/gateway/` (frontend) + existing Rust spawn | Chat / sessions stdio gateway. **Untouched by this refactor.** |

The two Python child processes are independent. The chat path keeps its
stdio JSON-RPC transport. The new sidecar handles only Model + Cron data.

## Component responsibilities

### Tauri Rust layer (`desktop/src-tauri/`)

- **`main.rs`** *(MODIFIED)*: register the new `sidecar` plugin alongside
  existing commands; on app startup, spawn the sidecar before the WebView
  is shown; on shutdown, terminate the sidecar gracefully.
- **`sidecar.rs`** *(NEW)*: owns the `desktop_backend` child process.
  - Spawns the sidecar (dev: `python3 -m desktop_backend`; release:
    bundled `externalBin` path).
  - Allocates a token (32 random bytes hex), writes it to a tempfile with
    mode `0600`, passes the path via env var `DESKTOP_SIDECAR_TOKEN_FILE`.
  - Reads `READY <port>` line on sidecar stdout; exposes the bound port
    and token via Tauri command `sidecar_info()` so the WebView can build
    its base URL.
  - Health check: `GET /desktop/api/health` every 5s after ready; on
    three consecutive failures, restart with exponential backoff (max 30s).
  - On app exit: `SIGTERM`, wait 2s, then `SIGKILL`.
- **`commands/fs.rs`** *(UNCHANGED)*: existing scoped FS commands stay.
- **`tauri.conf.json`** *(MODIFIED)*: add `bundle.externalBin` entry
  pointing at the PyInstaller `--onedir` output for release builds.

### Python sidecar (`desktop/backend/desktop_backend/`)

```
desktop_backend/
├─ __main__.py            # entrypoint: parse env, allocate port, run uvicorn
├─ app.py                 # FastAPI app factory + auth middleware + CORS
├─ config.py              # paths: HERMES_HOME, DESKTOP_HOME, token file
├─ routers/
│   ├─ health.py          # GET /desktop/api/health
│   ├─ cron.py            # GET /desktop/api/cron/jobs, /jobs/{id}
│   ├─ model.py           # GET /desktop/api/model/catalog, /providers
│   ├─ settings.py        # GET/PUT /desktop/api/settings
│   ├─ state.py           # GET/PUT /desktop/api/state
│   └─ overlays.py        # PATCH /desktop/api/overlays/{domain}/{id}
├─ services/
│   └─ merger.py          # combines Layer 1 + Layer 2 into responses
├─ readers/               # Layer 1 (COPIES of upstream, never imported)
│   ├─ __init__.py
│   ├─ cron_reader.py     # ← copy of cron/jobs.py (read-only subset)
│   └─ model_catalog.py   # ← copy of hermes_cli/model_catalog.py
├─ overlays/              # Layer 2 loader/writer (atomic + locked)
│   ├─ __init__.py
│   └─ loader.py
├─ store/                 # Layer 3 loader/writer
│   ├─ __init__.py
│   ├─ settings.py
│   └─ state.py
├─ schemas/               # Pydantic v2 models for wire types
│   ├─ cron.py
│   ├─ model.py
│   ├─ settings.py
│   └─ state.py
└─ util/
    ├─ atomic_write.py    # tmp + fsync + rename helper
    └─ filelock.py        # fcntl.flock context manager
```

Responsibilities:

- **`__main__.py`**: read `DESKTOP_SIDECAR_TOKEN_FILE` env var, call
  `uvicorn.Server` with `host="127.0.0.1"`, `port=0`, then on startup
  print `READY <port>` to stdout and flush.
- **`app.py`**: registers routers under `/desktop/api`, installs an auth
  dependency that checks `Authorization: Bearer <token>`, configures
  CORS for `tauri://localhost`.
- **`readers/`**: each file begins with a snapshot header (see D6 in
  overview). Only the parsing + path resolution logic from upstream is
  copied; CLI-specific entry points and side effects are stripped.
- **`overlays/loader.py`**: per-domain JSON load/save with file lock and
  atomic write. On parse failure, backs up to `<file>.corrupt-<ts>` and
  returns empty overlay.
- **`services/merger.py`**: pure function `merge(layer1_items,
  overlay_dict) -> list[MergedItem]`. Adds the `desktop` key per item.
- **`schemas/`**: response envelopes namespace shared and overlay fields
  per D8.

### Frontend services (`desktop/src/services/`)

```
services/
├─ gateway/                       # UNCHANGED — chat/session stdio path
└─ api/                           # NEW — single data egress for Model + Cron
    ├─ index.ts                   # public re-exports (`api`)
    ├─ router.ts                  # registry: domain.method → transport
    ├─ types.ts                   # domain interfaces (CronApi, ModelApi, ...)
    ├─ http-client.ts             # fetch wrapper with sidecar base URL + token
    ├─ transports/
    │   ├─ http/
    │   │   ├─ cron.ts            # implements CronApi via sidecar
    │   │   ├─ model.ts
    │   │   ├─ settings.ts
    │   │   ├─ state.ts
    │   │   └─ overlays.ts
    │   ├─ mock/
    │   │   ├─ cron.ts            # uses existing fixtures
    │   │   └─ model.ts
    │   └─ gateway/
    │       └─ (future)           # wraps services/gateway/* if a domain ever needs it
    └─ __tests__/
        ├─ router.test.ts
        └─ transports/...
```

Responsibilities:

- **`router.ts`**: maps each domain (`cron`, `model`, `settings`, `state`,
  `overlays`) to one transport implementation. Default in dev/release is
  `http`. Tests swap to `mock`. Never queried at call sites — the `api`
  facade hides it.
- **`http-client.ts`**: lazily fetches `sidecar_info()` from Tauri once,
  caches base URL + token, retries with backoff on connection failure
  during the sidecar's startup window.
- **`transports/http/*.ts`**: each file owns the wire serialization for
  one domain. Endpoints, query params, and response parsing live here
  and nowhere else.
- **`transports/mock/*.ts`**: mock implementations satisfy the same
  domain interface; used by Vitest and Storybook-style previews.
- **Boundary rule (D7)**: anything outside `services/api/` calling
  `services/gateway/` directly for a Model/Cron concern is a violation.
  ESLint enforces.

### Frontend stores (`desktop/src/stores/`)

- **`cron.ts`** *(NEW)*: holds `jobs` (`MergedCronJob[]`), `loading`,
  `error`, `lastFetchedAt`. Calls `api.cron.jobs.list()`. Exposes
  `togglePinned(id)` which calls `api.overlays.cron.patch(id,
  {pinned: ...})` and updates the local signal optimistically; rolls
  back on failure.
- **`models.ts`** *(MODIFIED)*: switch the data source from
  `MockGatewayAdapter` calls to `api.model.*`. Public store API
  (`modelStore.providers`, `modelStore.currentView`, etc.) stays the
  same so view components are not affected.
- **`settings.ts`** *(MODIFIED)*: persistence backend swap from gateway
  to `api.settings.*`. UI bindings unchanged.
- All other stores (`chat.ts`, `session.ts`, `ui.ts`) untouched.

### Module components (`desktop/src/modules/`)

- **`modules/cron/CronView.tsx`** *(MODIFIED)*: remove inline mock array,
  read from `cronStore.jobs`. Markup, CSS modules, sort/filter
  interactions stay byte-identical.
- **`modules/cron/CronJobCard.tsx` / `CronJobDetail.tsx`** *(MODIFIED)*:
  read `job.desktop.pinned` etc. instead of legacy ad-hoc flags.
- **`modules/model/*`** *(MODIFIED-MINIMAL)*: same pattern — store
  swap, no UI redesign.
- All other modules (`chat/`, `sessions/`, `settings/`, `skills/`,
  `mcp/`, `memory/`, `gateway/`) untouched.

## Final file tree (delta only)

Legend: **+** new, **~** modified, blank = unchanged.

```
desktop/
├── backend/                               +
│   ├── pyproject.toml                     +
│   ├── README.md                          +
│   └── desktop_backend/                   +
│       ├── __main__.py                    +
│       ├── app.py                         +
│       ├── config.py                      +
│       ├── routers/                       +
│       │   ├── health.py                  +
│       │   ├── cron.py                    +
│       │   ├── model.py                   +
│       │   ├── settings.py                +
│       │   ├── state.py                   +
│       │   └── overlays.py                +
│       ├── services/merger.py             +
│       ├── readers/                       +
│       │   ├── cron_reader.py             +
│       │   └── model_catalog.py           +
│       ├── overlays/loader.py             +
│       ├── store/{settings,state}.py      +
│       ├── schemas/                       +
│       └── util/{atomic_write,filelock}.py +
│
├── src/
│   ├── services/
│   │   ├── gateway/                       (unchanged)
│   │   └── api/                           +
│   │       ├── index.ts                   +
│   │       ├── router.ts                  +
│   │       ├── types.ts                   +
│   │       ├── http-client.ts             +
│   │       └── transports/{http,mock,gateway}/* +
│   ├── stores/
│   │   ├── cron.ts                        +
│   │   ├── models.ts                      ~
│   │   └── settings.ts                    ~
│   ├── modules/
│   │   ├── cron/CronView.tsx              ~
│   │   ├── cron/CronJobCard.tsx           ~
│   │   ├── cron/CronJobDetail.tsx         ~
│   │   └── model/*                        ~
│   └── pages/                             (unchanged)
│
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                        ~
│   │   ├── sidecar.rs                     +
│   │   └── commands/                      (unchanged)
│   └── tauri.conf.json                    ~
│
├── eslint.config.js                       ~  (no-restricted-imports rules)
└── package.json                           ~  (scripts: backend:dev, backend:build)
```

## Public API surface (sidecar endpoints)

All endpoints are prefixed `/desktop/api`. All require
`Authorization: Bearer <token>`. All return `application/json`.

| Method | Path | Purpose | Layers touched |
|---|---|---|---|
| GET | `/health` | Liveness probe (no auth) | none |
| GET | `/cron/jobs` | List merged cron jobs | L1 (read) + L2 (read) |
| GET | `/cron/jobs/{id}` | Single merged cron job | L1 + L2 |
| GET | `/model/catalog` | Provider/model catalog | L1 |
| GET | `/model/providers` | Configured providers (from catalog) | L1 + L2 |
| GET | `/settings` | Desktop settings | L3 |
| PUT | `/settings` | Replace desktop settings | L3 (write) |
| GET | `/state` | Desktop ephemeral state | L3 |
| PUT | `/state` | Replace desktop state | L3 (write) |
| PATCH | `/overlays/{domain}/{id}` | Update overlay for one entity | L2 (write) |

This is the **complete** wire surface for this refactor. Endpoints not
listed here are out of scope (see overview D9).

## Boundary enforcement

These rules are mechanically enforced; agents must not weaken them.

1. **ESLint `no-restricted-imports`** in `eslint.config.js`:
   - Files under `src/stores/` and `src/modules/` may not import
     `services/gateway/*` for Model/Cron domains. (Chat/sessions stores
     are exempted by path allow-list.)
   - Files outside `services/api/` may not import `services/api/transports/*`
     directly — only `@/services/api`.
2. **Python static check** (CI grep):
   - `desktop_backend/readers/**/*.py` MUST NOT contain `import
     hermes_cli`, `from hermes_cli`, `import cron`, `from cron`,
     `import agent`, `from agent`, `import tui_gateway`. Violation
     fails CI.
3. **Bind-address test**: integration test asserts the sidecar binds
   only `127.0.0.1` (never `0.0.0.0`).
4. **Layer 1 write guard**: integration test computes SHA-256 of every
   `~/.hermes/{cron,cache}/**` file before and after a full sidecar
   request battery; hashes must match. Any drift = test failure.
