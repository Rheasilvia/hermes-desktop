# 04 — Testing strategy

## Test layers

| Layer | Tool | Where | What it asserts |
|---|---|---|---|
| Sidecar unit | pytest | `desktop/backend/tests/unit/` | reader/overlay/merger logic in isolation |
| Sidecar integration | pytest + httpx | `desktop/backend/tests/integration/` | full request/response against a tmp `HERMES_HOME` |
| Frontend unit | vitest | `desktop/src/**/__tests__/*.test.ts` | router, transports (with mock fetch), stores |
| Frontend E2E | playwright | `desktop/tests/e2e/` | UI flows against `MockGatewayAdapter` + mock api transport |
| Boundary | pytest + grep + eslint | CI script | rules from architecture.md §"Boundary enforcement" |

## Sidecar unit tests

`desktop/backend/tests/unit/`

Required test files and minimum cases:

- `test_cron_reader.py`
  - parses a valid `jobs.json` fixture
  - returns `[]` when file missing
  - raises `L1CorruptError` when file is invalid JSON
  - never opens the file with write mode (mock `open`, assert
    `"w"` not in any call)
- `test_model_catalog_reader.py`
  - parses cached `model_catalog.json` fixture
  - never imports anything from upstream (verified by AST scan in CI,
    not in this test)
- `test_overlay_loader.py`
  - load returns `{}` for missing file
  - load returns `{}` and renames file when JSON is corrupt; backup
    file matches pattern `*.corrupt-<iso>`
  - update is atomic: simulate crash between tmp write and rename;
    original file unchanged
  - update preserves keys not mentioned in the patch
  - shared lock allows concurrent reads; exclusive lock blocks
    concurrent writes
- `test_merger.py`
  - merges L1 + L2 with the expected `desktop` field shape
  - missing overlay entry produces `desktop = default_overlay()`
  - extra overlay entries (orphaned by L1) are NOT included in output
- `test_atomic_write.py`
  - happy path produces target file with exact bytes
  - failure during fsync leaves original file unchanged
  - tmp file is in same directory as target
- `test_filelock.py`
  - exclusive lock raises `LockedError` after retry budget exhausted

## Sidecar integration tests

`desktop/backend/tests/integration/`

Each test spins up a FastAPI `TestClient`, points `HERMES_HOME` at a
`tmp_path` populated with fixtures.

- `test_health.py`
  - `GET /desktop/api/health` returns 200 without auth
- `test_auth.py`
  - request with no `Authorization` → 401
  - request with wrong token → 401
  - request with correct token → 200
  - constant-time compare (statistical, not strict)
- `test_cron_endpoints.py`
  - `GET /cron/jobs` with no overlay → all jobs have `desktop:
    default_overlay()`
  - `GET /cron/jobs` with overlay → matching jobs have overlay fields
  - `GET /cron/jobs/{id}` → 200 with full merged shape; 404 for unknown
  - corrupt L1 → 503 with `code: L1_CORRUPT` and absolute path
  - corrupt L2 → 200 with default overlay AND backup file created
- `test_overlay_endpoints.py`
  - `PATCH /overlays/cron/{id}` with `{pinned: true}` → 200, file
    contains exactly the new field merged with existing
  - PATCH for non-existent L1 entity → still succeeds (overlay can
    be set ahead of L1)
  - body fails Pydantic validation → 422
- `test_settings_endpoints.py`
  - `GET /settings` returns defaults when file missing
  - `PUT /settings` with mismatched `schema_version` → 409
  - `PUT /settings` round-trip equality
- `test_layer1_immutability.py` *(critical)*
  - hash all files under `tmp_hermes_home/{cron,cache}` recursively
  - run a battery of all GET + PATCH + PUT endpoints (50× each)
  - re-hash; assert byte-identical
- `test_bind_address.py`
  - start uvicorn via the sidecar's `__main__`; assert it bound to
    `127.0.0.1`, never `0.0.0.0` or `::`.
- `test_corrupt_l2_does_not_block_l1.py` *(critical)*
  - place corrupt overlay file
  - `GET /cron/jobs` returns 200 with all L1 jobs
  - assert backup file exists
  - assert response contains the recovery header

## Frontend unit tests

`desktop/src/services/api/__tests__/`

- `router.test.ts`
  - registry resolves each domain to its registered transport
  - swapping transport at registry level changes resolution
  - calling unknown domain throws a typed error
- `http-client.test.ts`
  - prepends correct base URL + auth header
  - retries 3× on connection error (use mock fetch with controllable
    rejection)
  - does NOT retry PATCH/PUT
  - on 401, calls `invoke('sidecar_info')` and retries once
  - parses error envelope into `ApiError`
- `transports/http/cron.test.ts`
  - `list()` shapes response correctly
  - propagates ApiError unchanged
- `transports/http/overlays.test.ts`
  - PATCH builds correct path + body

`desktop/src/stores/__tests__/`

- `cron.test.ts`
  - load() populates jobs, sets loading false
  - load() failure sets error, keeps last successful jobs
  - togglePinned applies optimistic update
  - togglePinned rolls back on PATCH failure

## Frontend E2E

`desktop/tests/e2e/`

E2E tests run Playwright against the Vite dev server with the api
router pointing at the **mock transport** (no Python required for E2E
in CI).

- `cron-page.spec.ts`
  - navigates to /cron
  - sees mocked jobs
  - toggles pin → UI reflects new state
  - mock transport throws → error banner appears, jobs remain visible
- `model-page.spec.ts`
  - navigates to /model
  - sees mocked providers
  - clicks into provider detail → detail view renders

A separate, **opt-in** suite (`tests/e2e-sidecar/`) runs Playwright
against the dev sidecar (`python3 -m desktop_backend`) for true
end-to-end verification. This is gated behind `npm run test:e2e:sidecar`
and is not required to pass in default CI.

## Boundary tests (CI)

Run as a single CI step `npm run test:boundaries`:

1. **No upstream Python imports**: grep `desktop/backend/desktop_backend/`
   for any of `import hermes_cli`, `from hermes_cli`, `import cron`,
   `from cron`, `import agent`, `from agent`, `import tui_gateway`,
   `from tui_gateway`. Any match → fail.
2. **No gateway imports from Model/Cron stores/modules**: ESLint with
   `no-restricted-imports`. Allowlist for chat/sessions paths.
3. **No direct transport imports**: ESLint forbids importing
   `services/api/transports/*` from anywhere outside `services/api/`.
4. **Snapshot header present**: every file under
   `desktop_backend/readers/` must contain a `# SNAPSHOT:` header with
   `source:`, `upstream_sha:`, `copied_at:` fields. CI grep enforces.

## Test data fixtures

`desktop/backend/tests/fixtures/hermes_home/` contains a self-contained
fake `~/.hermes/` tree:
- `cron/jobs.json` — minimal valid jobs file
- `cache/model_catalog.json` — minimal valid catalog
- `cron/jobs.corrupt.json` — for corruption tests (loaded by renaming
  in test setup)

`desktop/src/services/api/__tests__/fixtures/` contains JSON fixtures
matching the sidecar wire format.

Fixtures use synthetic IDs (`job_test_001`, `provider_test_anthropic`)
and never reference real account data.

## Coverage targets

- Sidecar: ≥ 90% line coverage (small surface, easy target).
- Frontend `services/api/`: ≥ 90%.
- Frontend stores (`cron.ts`, `models.ts` changes): ≥ 80%.
- Modules: covered by E2E only; no unit-coverage requirement.

## What we deliberately do NOT test

- macOS code signing / notarization workflow (manual + future CI).
- PyInstaller bundle size or startup time (manual smoke).
- Cross-platform (Windows / Linux) — desktop release target is macOS
  for now; sidecar code stays portable but is only CI-tested on macOS.
- Network attached storage behavior for `~/.hermes/`.
