# 02 — Data flow

This document specifies the runtime sequences. Each flow is normative —
implementing agents must follow these step orders.

## Startup sequence

```
Tauri main.rs                  sidecar.rs                  desktop_backend
─────────────                  ──────────                  ───────────────
app launch
  │
  ├─▶ acquire single-instance lock
  │
  ├─▶ sidecar::spawn() ──────▶ generate 32-byte token
  │                            write token to mkstemp(mode=0600)
  │                            spawn child:
  │                               dev:     python3 -m desktop_backend
  │                               release: <Resources>/desktop_backend/desktop_backend
  │                            env: DESKTOP_SIDECAR_TOKEN_FILE=<path>
  │                                 HERMES_HOME=<resolved>
  │                                                          │
  │                                                          ├─ read env
  │                                                          ├─ build FastAPI app
  │                                                          ├─ uvicorn(host=127.0.0.1, port=0)
  │                                                          ├─ on startup hook:
  │                                                          │     print("READY <port>")
  │                                                          │     sys.stdout.flush()
  │                            ◀───────────────────────────  │
  │                            parse "READY <port>"
  │                            store (port, token_path)
  │                            health check loop start
  │
  ├─▶ Tauri command sidecar_info() registered
  │
  ├─▶ create main window  ───▶ WebView starts loading
  │                              │
  │                              ├─ first api.* call →
  │                              │    invoke('sidecar_info') → {port, token}
  │                              │    construct base URL http://127.0.0.1:<port>
  │                              │    set Authorization header
  │                              ▼
  │                            HTTP request → sidecar
```

### Startup timing budget

| Step | Target | Hard ceiling |
|---|---|---|
| Token generation + tempfile | <10ms | 100ms |
| Python interpreter cold start (release, PyInstaller `--onedir`) | <600ms | 1500ms |
| FastAPI app construction | <100ms | 500ms |
| First `READY <port>` line emitted | <800ms total | 2000ms |
| Frontend first successful `/health` | <1200ms total | 3000ms |

If `READY` is not seen within 5s, sidecar.rs treats this as a fatal
spawn failure, kills the child, and surfaces an error to the WebView via
a Tauri event (`sidecar://failed`). The frontend shows a non-blocking
error banner and disables Model/Cron pages (chat still works).

## Read flow: `GET /desktop/api/cron/jobs`

```
modules/cron/CronView.tsx
  │ onMount → cronStore.load()
  ▼
stores/cron.ts
  │ api.cron.jobs.list()
  ▼
services/api/router.ts
  │ resolves 'cron.jobs.list' → transports/http/cron.ts
  ▼
transports/http/cron.ts
  │ http.get('/cron/jobs')
  ▼
http-client.ts
  │ ensure baseUrl + token loaded (Tauri invoke once)
  │ fetch(baseUrl + '/desktop/api/cron/jobs',
  │       headers: { Authorization: 'Bearer <token>' })
  ▼
═══════════════ HTTP boundary ═══════════════
  ▼
desktop_backend/app.py (auth middleware)
  │ verify Bearer token (constant-time compare)
  ▼
routers/cron.py: list_jobs()
  │
  ├─▶ readers/cron_reader.load_jobs(HERMES_HOME)
  │     opens ~/.hermes/cron/jobs.json (read-only, fcntl shared lock)
  │     returns list[CronJobL1]
  │
  ├─▶ overlays/loader.load('cron')
  │     opens ~/.hermes/desktop/overlays/cron.json (read-only)
  │     on parse error → backup + return {}
  │     returns dict[str, OverlayEntry]
  │
  ├─▶ services/merger.merge_cron(jobs, overlay)
  │     for each L1 job:
  │       merged.id = job.id
  │       merged.schedule = job.schedule
  │       ...
  │       merged.desktop = overlay.get(job.id, default_overlay())
  │
  └─▶ return JSON: { items: [MergedCronJob, ...], generated_at: <iso> }
  ▼
═══════════════ HTTP boundary ═══════════════
  ▼
http-client.ts: parse JSON, validate envelope
  ▼
transports/http/cron.ts: shape into domain return type
  ▼
stores/cron.ts:
  setJobs(items)
  setLoading(false)
  setLastFetchedAt(now)
  ▼
CronView.tsx re-renders (Solid signal)
```

### Caching policy (frontend)

- Stores hold the last response in memory. No persistent cache for
  Layer 1 data.
- Refetch triggers:
  - First mount of the view.
  - User pull-to-refresh / explicit refresh button.
  - Window focus event after >60s of background.
- No background polling. (Cron job execution state is not in scope.)

### Caching policy (sidecar)

- Sidecar does **not** cache Layer 1 file contents in memory between
  requests. Each request re-reads the file. Files are tiny (KB) and
  this avoids stale-data hazards from external edits by CLI/upstream.
- Model catalog parsing may use the existing on-disk cache that
  upstream `model_catalog.py` already maintains
  (`~/.hermes/cache/model_catalog.json`). This cache is read-only from
  the sidecar's POV (sidecar never refreshes it).

## Write flow: `PATCH /desktop/api/overlays/cron/{id}` (e.g. toggle pin)

```
CronJobCard onClick "pin"
  ▼
stores/cron.ts: togglePinned(id)
  │ // optimistic update
  │ const prev = jobs[id].desktop
  │ setJobOverlay(id, { ...prev, pinned: !prev.pinned })
  │
  │ try:
  │   await api.overlays.cron.patch(id, { pinned: !prev.pinned })
  │ catch err:
  │   setJobOverlay(id, prev)        // rollback
  │   showToast('Could not save preference')
  ▼
transports/http/overlays.ts
  │ http.patch('/overlays/cron/' + id, body)
  ▼
═══════════════ HTTP boundary ═══════════════
  ▼
routers/overlays.py: patch(domain, id, body)
  │ validate body via Pydantic (OverlayPatch)
  │
  ├─▶ overlays/loader.update('cron', id, patch):
  │     acquire fcntl.flock exclusive on overlay file
  │     try:
  │       data = read_json(file)            # may be {} on parse error
  │     except corrupt:
  │       backup file as <name>.corrupt-<ts>
  │       data = {}
  │     existing = data.get(id, default_overlay())
  │     merged = { **existing, **patch, "updated_at": now_iso() }
  │     data[id] = merged
  │     atomic_write(file, data)            # tmp + fsync + rename
  │     release lock
  │     return merged
  │
  └─▶ return JSON: { id, desktop: <merged> }
  ▼
stores/cron.ts:
  // confirm optimistic state matches server state
  setJobOverlay(id, response.desktop)
```

### Atomic write contract

`util/atomic_write.py` MUST:
1. Write payload to `<target>.tmp.<pid>.<rand>` in the same directory.
2. `fsync()` the tmp file.
3. `os.replace(tmp, target)` (atomic on POSIX same-fs).
4. `fsync()` the parent directory.

Any step failure raises and the lock is released; original file remains
unchanged.

### Lock contract

- Read paths use `fcntl.LOCK_SH` (shared).
- Write paths use `fcntl.LOCK_EX` (exclusive).
- All locks are non-blocking with a 250ms retry budget × 4 (1s total).
- Lock is on the target file itself (or its lock-sibling if file may
  not exist yet: `<file>.lock`).

## Write flow: `PUT /desktop/api/settings` (Layer 3, full replace)

Same shape as overlay write but no merge — full replace of the JSON
object after Pydantic validation against the settings schema. Schema
versioning field `schema_version: int` is required; sidecar rejects
mismatched versions with `409 Conflict` and the migration is performed
by sidecar startup, not by the request handler.

## Failure recovery

See `03-error-handling.md` for the complete error contract. Key
data-flow consequences:

- **Sidecar down at request time**: `http-client.ts` retries 3× with
  100ms/300ms/700ms backoff. After that, propagates a `SidecarUnavailable`
  error to the store, which sets `error` and keeps the last successful
  data visible (stale UI is preferable to empty UI).
- **Layer 2 corrupt**: read returns Layer 1 only with empty overlay;
  write performs corrupt-backup then writes new file. Either way the
  request succeeds.
- **Layer 1 missing** (no `~/.hermes/cron/jobs.json` yet): sidecar
  returns `{ items: [], generated_at: <iso> }`. Empty state UI shows
  "No cron jobs configured" — no error.
- **Layer 1 corrupt**: sidecar returns `503` with body
  `{ code: "L1_CORRUPT", domain: "cron", path: <abs> }`. Frontend shows
  an error card with "Open file" action (Tauri shell). Does not back
  up Layer 1 — that's upstream's data, not desktop's.

## Shutdown sequence

```
Tauri window close / quit
  │
  ├─▶ frontend: no special teardown (HTTP is stateless)
  │
  ├─▶ sidecar.rs::shutdown()
  │     send SIGTERM to child
  │     wait up to 2s for exit
  │     if still alive: SIGKILL
  │     unlink token file
  │
  └─▶ release single-instance lock
      exit
```

Sidecar's FastAPI shutdown handler closes any open file handles;
locks are released by the kernel on process death even if the handler
is skipped.
