# 05 — Implementation notes

This file is the onboarding doc for the agents who will implement the
spec. Read it after the other five sections.

## Suggested implementation order

The order minimizes blocked work and surfaces architectural mistakes
early.

1. **Sidecar skeleton** (`desktop/backend/`)
   - `pyproject.toml`, `__main__.py`, `app.py`, `config.py`,
     `routers/health.py`. Get `READY <port>` working under
     `python3 -m desktop_backend`.
2. **Reader copies** (D6)
   - Copy `cron/jobs.py` → `readers/cron_reader.py`. Strip imports.
     Add snapshot header. Write unit tests.
   - Same for `model_catalog.py`.
3. **Overlay loader + atomic write + filelock** utilities + tests.
4. **Cron router** end-to-end (read path only) + integration tests.
5. **Settings/state routers** + integration tests.
6. **Overlay PATCH router** + integration tests.
7. **Tauri Rust sidecar.rs**
   - Spawn (dev mode), READY parsing, token file, `sidecar_info`
     command, health check loop, restart with backoff.
8. **Frontend `services/api/`**
   - `types.ts`, `router.ts`, `http-client.ts`, `transports/http/*`.
   - Vitest unit tests with mock fetch.
9. **Frontend stores**
   - `cron.ts` (new). Then refactor `models.ts`, `settings.ts` to use
     the api facade.
10. **Module wiring**
    - `CronView.tsx`: replace mock array with store.
    - Model module: store source swap only.
11. **Boundary CI** (eslint rules, grep script).
12. **Packaging path**
    - PyInstaller `--onedir` recipe.
    - `tauri.conf.json` `externalBin` entry.
    - Smoke build a signed `.app`. Verify single Gatekeeper auth.

Each numbered step should land in its own commit (or PR).

## Build & dev commands

```bash
# Sidecar dev (from desktop/backend/)
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
python -m desktop_backend                    # prints READY <port>

# Sidecar tests
pytest                                       # all
pytest tests/integration/test_layer1_immutability.py  # critical
pytest --cov=desktop_backend --cov-report=term

# Sidecar release build (manual, until CI lands)
pyinstaller \
  --onedir \
  --noconfirm \
  --name desktop_backend \
  --distpath dist \
  desktop_backend/__main__.py

# Frontend (from desktop/)
npm run dev                                  # vite only
npm run tauri:dev                            # tauri spawns sidecar
npm run test                                 # vitest
npm run test:e2e                             # playwright (mock api)
npm run test:boundaries                      # ESLint + grep
npm run tauri:build                          # full release
```

`npm run tauri:dev` must spawn the sidecar from
`desktop/backend/.venv/bin/python -m desktop_backend` if a venv exists,
falling back to system `python3`. This is configured via the
`sidecar.rs` spawn logic, not via npm.

## Snapshot header template (D6)

Every file in `desktop_backend/readers/` MUST start with:

```python
# SNAPSHOT:
#   source: cron/jobs.py
#   upstream_sha: 69e4387e527e45fcd715dab02e4c3857872e1641
#   copied_at: 2026-05-05
#   stripped:
#     - CLI entry points (argparse, click)
#     - logging configuration (use stdlib logging in sidecar)
#   resync_when:
#     - upstream `jobs.json` schema adds new required fields
#     - upstream rename of cron file location
```

The `resync_when` list is the only field that may be edited after
copy; the other fields are immutable for the lifetime of the snapshot.
A new snapshot = bump `upstream_sha` and `copied_at`, regenerate diff
in PR description.

## Acceptance criteria

The refactor is "done" when ALL of the following are true:

- [ ] `npm run tauri:dev` launches the desktop app, the sidecar is
      spawned automatically, and Cron + Model pages display data
      sourced from `~/.hermes/` (not from frontend mock fixtures).
- [ ] Removing `tui_gateway` from `PYTHONPATH` does not affect the
      Cron + Model pages. (Chat path may break — that's expected; out
      of scope.)
- [ ] All endpoints listed in `01-architecture.md §"Public API
      surface"` are implemented and pass integration tests.
- [ ] Layer 2 corruption test passes: deleting/garbling
      `~/.hermes/desktop/overlays/cron.json` does not break the Cron
      page; backup file appears.
- [ ] Layer 1 immutability test passes: a full request battery does
      not modify any byte under `~/.hermes/{cron,cache}/`.
- [ ] `npm run test:boundaries` passes (no upstream Python imports,
      no `services/gateway` imports from Model/Cron stores/modules).
- [ ] All new sidecar tests + frontend unit tests pass at the coverage
      targets in `04-testing.md`.
- [ ] A signed release `.app` launches on a fresh macOS user account
      with **one** Gatekeeper authorization prompt for the whole bundle
      (sidecar must be co-signed, not separately authorized).
- [ ] Visual regression: a screenshot of `/cron` and `/model` before
      vs after this refactor shows no pixel-diff outside the data
      content area. (Use existing Playwright + screenshot diff.)

## Definitely don't (explicit anti-list)

These are common mistakes implementing agents will be tempted to make.
Don't:

- ❌ Import anything from `hermes_cli/`, `cron/`, `agent/`,
      `tui_gateway/`, or `web/` inside `desktop_backend/`. Copy + strip
      instead. Snapshot header required.
- ❌ Bind the sidecar to `0.0.0.0` or any non-loopback address.
- ❌ Pass the bearer token via argv. Use the token file (D2).
- ❌ Use PyInstaller `--onefile`. macOS code signing breaks because
      `--onefile` extracts to `/tmp` at runtime (D4).
- ❌ Run a fixed port. Use `port=0` and parse `READY <port>`.
- ❌ Cache Layer 1 file contents in the sidecar (no in-memory cache).
- ❌ Modify Layer 1 files from the sidecar. Ever.
- ❌ Rename or back up Layer 1 files when they're corrupt. Return 503
      and let upstream/CLI fix them.
- ❌ Add `create / edit / delete` endpoints for cron jobs. Out of
      scope (D9).
- ❌ Add OAuth / API-key entry endpoints in the sidecar. Out of scope.
- ❌ Change UI markup, CSS, or interactions in the cron/model modules.
      Only the data source changes (D10).
- ❌ Have stores call `fetch()` directly or import
      `services/gateway/*` for cron/model concerns (D7).
- ❌ Have anything outside `services/api/` import
      `services/api/transports/*`.
- ❌ Re-export the sidecar's HTTP client from a public package surface.
      It's an internal detail of `services/api/`.
- ❌ Skip the `schema_version` field on Layer 3 PUT bodies.
- ❌ Skip the `READY <port>` line. Tauri sidecar.rs blocks on it.
- ❌ Use `print` for sidecar logging on stderr — use the structured
      logger (single JSON object per line per `03-error-handling.md`).
- ❌ Modify `services/gateway/` (chat / sessions stdio path). It is
      explicitly out of scope.
- ❌ Migrate chat / session stores to the new api facade. Different
      problem; different time.

## Implementing-agent context bundle

When picking up this refactor in a fresh session, an agent should:

1. Read all six spec files in order (00 → 05, then README.md).
2. `git log --oneline -20` on `feat/desktop-standalone` for current state.
3. `cat desktop/backend/pyproject.toml` (if it exists) to see what
   sidecar work has landed.
4. `ls desktop/src/services/api/ 2>/dev/null` to see what frontend
   work has landed.
5. Check `TaskList` for in-flight work owned by other agents.
6. Resume at the next "Suggested implementation order" step that has
   no completed marker.

## Open questions explicitly deferred

These are real uncertainties; do **not** answer them as part of this
refactor:

- Whether to ship a Linux/Windows release. (Sidecar code stays
  portable, packaging story is undefined.)
- Whether the sidecar should expose a websocket for push updates
  (e.g., overlay changed elsewhere). Currently no, polling on focus.
- Whether to ever expose the sidecar to the local network for
  inter-device control. Currently no, hard `127.0.0.1` only.
- Whether Layer 3 settings should sync via iCloud / Dropbox.
  Currently no — explicitly out of scope (overview "Non-goals").
