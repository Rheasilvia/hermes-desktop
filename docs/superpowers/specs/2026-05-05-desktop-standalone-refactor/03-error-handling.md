# 03 — Error handling

## Principles

1. **Layer 1 reads must never fail because of Layer 2 problems.** The
   refactor's hardest invariant. Encoded as test (see 04-testing.md).
2. **The frontend always renders something.** Never a white screen.
   Stale data with an inline error indicator is preferable to an empty
   page.
3. **Errors are typed at the boundary.** Sidecar returns a typed envelope;
   transport layer converts to a typed `ApiError`; stores convert to
   user-visible state.
4. **Corruption is recovered, not propagated.** If a desktop-owned
   file (Layer 2 or Layer 3) cannot be parsed, sidecar backs it up and
   continues with defaults. The user sees a notification, not a crash.
5. **Upstream-owned files are never auto-modified.** If `~/.hermes/cron/
   jobs.json` is corrupt, the sidecar refuses but does NOT touch it.
   Only upstream/CLI is allowed to repair Layer 1.

## Error envelope (wire format)

All non-2xx responses from `/desktop/api/*` use this body shape:

```json
{
  "code": "L1_CORRUPT",
  "domain": "cron",
  "path": "/Users/<u>/.hermes/cron/jobs.json",
  "detail": "Expected JSON object at position 142",
  "trace_id": "01HXYZ..."
}
```

`code` is one of the constants in the table below. `path` is omitted
for codes that are not file-bound. `trace_id` is always present and is
echoed in sidecar logs for correlation.

## Error code table

| HTTP | `code` | When | Sidecar action | Frontend action |
|---|---|---|---|---|
| 401 | `AUTH_FAILED` | Bearer token missing or wrong | reject request | force `sidecar_info()` re-fetch, retry once; if still fails, show fatal banner |
| 404 | `NOT_FOUND` | Unknown entity id (e.g. `/cron/jobs/<bad>`) | return 404 | show 404 view |
| 409 | `SCHEMA_VERSION` | PUT body `schema_version` ≠ current | reject without write | show "settings need migration" modal |
| 422 | `VALIDATION` | Pydantic validation fail on request body | reject | show inline form error |
| 423 | `LOCKED` | File lock contention exceeded retry budget | reject | retry once after 1s; if still locked, toast "Busy, try again" |
| 500 | `INTERNAL` | Unhandled exception | log full traceback w/ trace_id | toast "Unexpected error" + offer "Report" |
| 503 | `L1_CORRUPT` | Layer 1 file unparseable | refuse, do NOT modify file | show error card with "Open in Finder" action |
| 503 | `L1_MISSING_DIR` | `~/.hermes/` doesn't exist | refuse | show first-run setup hint pointing at CLI |
| 503 | `SIDECAR_DOWN` | (synthesized by frontend, not server) | n/a | show banner + disable Model/Cron pages |

Note: Layer 2 corruption does NOT appear in this table because it never
becomes a user-facing error. It is recovered transparently and surfaces
only as a log entry + an info-level toast ("Restored desktop preferences
from defaults").

## Recovery procedures

### Layer 2 (overlay) parse failure

When `overlays/loader.load(domain)` encounters invalid JSON:

1. Compute `backup_path = file + ".corrupt-" + iso_utc_now_safe()`
   (e.g. `cron.json.corrupt-2026-05-05T09-00-00Z`).
2. `os.rename(file, backup_path)`. If rename fails, log and continue
   (do not abort).
3. Return `{}` to the caller.
4. Emit log entry at WARNING level with: original path, backup path,
   parse error excerpt.
5. Push a one-shot toast event via the next response's headers
   (`X-Desktop-Recovery: overlay/cron`) — frontend translates to a
   non-blocking info toast.

The next write to that domain creates a fresh file.

### Layer 3 (settings/state) parse failure

Same procedure as Layer 2, except the in-memory default object is the
default settings/state schema (defined in `desktop_backend/schemas/`).

### Layer 1 (upstream) parse failure

1. Do **not** rename, back up, or modify the file.
2. Return HTTP 503 with `code: "L1_CORRUPT"` and the absolute path.
3. Log at ERROR level.
4. Frontend shows a card explaining "Hermes data file appears
   corrupted" with two actions:
   - **Open in Finder** (Tauri shell `reveal_in_finder(path)`).
   - **Open Hermes CLI docs** (external URL).

### Sidecar process crash

`sidecar.rs` health-check loop:
- Probe `GET /desktop/api/health` every 5s.
- Three consecutive failures (no response within 1s each) → declare
  unhealthy.
- On unhealthy:
  1. Send SIGTERM, wait 1s, SIGKILL.
  2. Wait `min(2^attempt, 30)` seconds (attempt resets on success).
  3. Respawn.
  4. Emit Tauri event `sidecar://restarted` so frontend can clear
     stale error state and refetch.
- Hard cap: 5 restarts in 60s → stop trying, emit `sidecar://failed`,
  Model/Cron pages stay disabled until next app launch.

### Frontend lost connection (transient)

`http-client.ts` retry policy for connection-level errors (ECONNREFUSED,
EHOSTUNREACH, fetch network error, timeouts):
- Retry 3× with backoffs 100ms / 300ms / 700ms.
- Idempotent methods only (GET). PATCH/PUT do NOT auto-retry; the
  store handles rollback + user-driven retry.
- Final failure throws `SidecarUnavailableError` which the store maps
  to a banner state.

### Token rotation / mismatch

If the sidecar restarts, its token changes. Frontend's cached token
becomes invalid → next request returns 401. Handler:

1. On any 401, `http-client.ts` calls `invoke('sidecar_info')` again
   (forced refresh), updates cached token, retries once.
2. If second attempt also returns 401, surface `AUTH_FAILED` to store.

## Logging contract (sidecar)

- Stdout: `READY <port>` line on startup, no other normal-path output.
- Stderr: structured logs (one JSON object per line) at INFO and above:
  `{ "ts": "...", "level": "INFO", "trace_id": "...", "msg": "...",
     "event": "request.completed", ... }`.
- Tauri captures stderr and writes to
  `<app_data>/logs/sidecar-<date>.log` with daily rotation, 7 days
  retained.
- DEBUG level off by default; enabled by env `DESKTOP_SIDECAR_LOG=DEBUG`
  set by Tauri when an in-app "Verbose logging" toggle is on (Layer 3
  setting).

## Logging contract (frontend)

- Errors that reach the store layer are logged via existing
  `console.error` + the existing error boundary path.
- `ApiError` instances include `code`, `traceId`, and `domain`. The
  `traceId` is shown in any user-facing error card to ease support.

## Out-of-scope failure modes (explicit)

This refactor does NOT handle:

- Multi-user concurrent edits to the same Layer 2 file from multiple
  desktop instances. Single-instance lock prevents this for desktop;
  no protection against an external editor.
- Disk-full on write. Atomic write will raise; sidecar surfaces 500;
  no special UI.
- File system permission errors. Same as above; logged + 500.
- Network-attached `~/.hermes/`. Lock semantics may differ on NFS;
  not supported.
