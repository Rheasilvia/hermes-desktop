# Hermes Studio Sidecar API Contracts

Hermes Studio keeps `/desktop/api` as an internal compatibility namespace. The
name predates the Electron host, but changing it would churn the Studio
`HttpGatewayAdapter`, feature services, sidecar route tests, and persisted
diagnostics without creating a user-facing capability. It is not a public API,
an IPC contract, or evidence that the former native host remains. Electron main
still owns how the loopback process is bound, discovered, authenticated, and
supervised.

The executable contract is code-first:

- [app.py](../sidecar/daemon/app.py) sets `API_PREFIX`, authentication,
  exception envelopes, and the complete router mount list;
- the linked files under `sidecar/daemon/routers` own HTTP methods, paths, and
  inline payloads;
- the linked Pydantic files under `sidecar/daemon/schemas` own named REST
  request/response payloads; and
- [GatewayEventMap](../src/services/gateway/types.ts) and its imported
  [renderer payload types](../src/types/index.ts) own normalized renderer event
  payloads.

This inventory is a navigation and compatibility record. When prose and those
sources differ, the typed source and its tests win; update this document in the
same change.

## Discovery, origin, and authentication

The sidecar binds `127.0.0.1` only. Browser CORS access is an exact allow-list:

- `hermes-studio://app` for packaged Hermes Studio;
- `http://localhost:1420` for browser/Playwright development; and
- `http://127.0.0.1:1420` for Electron development.

Other ports and origins are rejected. `GET /desktop/api/health` is public so
Electron can supervise startup. All other REST routes require
`Authorization: Bearer <api-token>`. Workspace authorization additionally uses
`X-Desktop-Workspace-Grant`; Electron main creates and retains that grant, and
it is never part of `window.hermesStudio.backend.info()`.

Every renderer REST call flows through the shared `HttpClient`. In Electron it
discovers `{baseUrl, token}` only through `backend.info()` and sends the token
as a bearer header. Bridge presence is authoritative: native discovery failure
does not fall back to page-controlled variables or a default port. A `401`
causes one forced native rediscovery and one retry.

When the bridge is absent, non-production browser development and Playwright
may provide both `VITE_SIDECAR_URL` and `VITE_SIDECAR_TOKEN`. Production builds
ignore that fallback and contain no baked endpoint or credential.

## REST route and payload inventory

All paths below are relative to `/desktop/api`. A source entry names the router
that owns the exact endpoint behavior and the schema module that owns named
payloads. “Inline” means the router's Pydantic class or returned dictionary is
the payload authority.

| Capability | Methods and paths | Route and payload authority |
| --- | --- | --- |
| Health | `GET /health` | [health.py](../sidecar/daemon/routers/health.py); inline health dictionary |
| Cron | `GET, POST /cron/jobs`; `GET, PATCH, DELETE /cron/jobs/{job_id}` | [cron.py](../sidecar/daemon/routers/cron.py), [cron schema](../sidecar/daemon/schemas/cron.py) |
| Provider OAuth | `GET /providers/oauth`; `POST /providers/oauth/{provider_id}/start, /submit`; `GET /providers/oauth/{provider_id}/poll/{session_id}`; `DELETE /providers/oauth/{provider_id}, /providers/oauth/sessions/{session_id}` | [oauth.py](../sidecar/daemon/routers/oauth.py), [oauth schema](../sidecar/daemon/schemas/oauth.py) |
| Configuration | `GET /config, /config/defaults, /config/schema`; `PUT /config` | [config.py](../sidecar/daemon/routers/config.py), [config schema](../sidecar/daemon/schemas/config.py) |
| Models/providers | `GET, PUT /model/active`; `GET /model/catalog, /model/providers, /model/auxiliary`; `POST /model/providers, /model/assignment`; `DELETE /model/providers/{provider_id}`; provider key/model-config/params subroutes | [model.py](../sidecar/daemon/routers/model.py), [model schema](../sidecar/daemon/schemas/model.py) |
| Audio | `POST /audio/transcribe, /audio/speak`; `GET /audio/elevenlabs/voices` | [audio.py](../sidecar/daemon/routers/audio.py), [audio schema](../sidecar/daemon/schemas/audio.py) |
| Settings | `GET, PUT /settings` | [settings.py](../sidecar/daemon/routers/settings.py), [settings schema](../sidecar/daemon/schemas/settings.py) |
| Desktop state | `GET, PUT /state` | [state.py](../sidecar/daemon/routers/state.py); inline state dictionary |
| Entity overlays | `PATCH /overlays/{domain}/{entity_id}` | [overlays.py](../sidecar/daemon/routers/overlays.py); inline patch document/result |
| Analytics | `GET /analytics/models` | [analytics.py](../sidecar/daemon/routers/analytics.py), [analytics schema](../sidecar/daemon/schemas/analytics.py) |
| Skills/toolsets | `GET /skills, /toolsets`; `PUT /skills/toggle` | [skills.py](../sidecar/daemon/routers/skills.py), [skills schema](../sidecar/daemon/schemas/skills.py) |
| MCP | `GET, POST /mcp/servers`; `DELETE, PATCH /mcp/servers/{name}`; `POST /mcp/reload`; `GET /mcp/servers/{name}/tools` | [mcp.py](../sidecar/daemon/routers/mcp.py), [MCP schema](../sidecar/daemon/schemas/mcp.py) |
| Tools | `GET /tools`; `POST /tools/reload` | [tools.py](../sidecar/daemon/routers/tools.py), [tools schema](../sidecar/daemon/schemas/tools.py) |
| Plugins | hub/rescan lists; install, enable, disable, update, delete, provider-selection, and visibility routes under `/plugins` | [plugins.py](../sidecar/daemon/routers/plugins.py), [plugins schema](../sidecar/daemon/schemas/plugins.py) |
| Profiles | list/create/update/archive, active profile, per-profile state, and profile-session routes under `/profiles` | [profiles.py](../sidecar/daemon/routers/profiles.py); request classes and response dictionaries are inline |
| Conversations | session CRUD/provider/branch/rewind/permission/runtime/messages/transcript; `POST /prompt/execute`; image attach/detach; interrupt/steer; approval/clarify/user-input/sudo/secret responses | [conversations.py](../sidecar/daemon/routers/conversations.py), [conversation schema](../sidecar/daemon/schemas/conversation.py) |
| Commands | catalog, slash/path completion, slash execution/prompt resolution, and dispatch under `/commands` | [commands.py](../sidecar/daemon/routers/commands.py), [commands schema](../sidecar/daemon/schemas/commands.py) |
| Delegation | `GET /delegation/status`; `POST /delegation/pause`; `POST /subagents/{subagent_id}/interrupt` | [delegation.py](../sidecar/daemon/routers/delegation.py), [delegation schema](../sidecar/daemon/schemas/delegation.py) |
| Workspace | children/read/write/reveal routes under `/sessions/{session_id}/workspace` | [workspace.py](../sidecar/daemon/routers/workspace.py), [workspace schema](../sidecar/daemon/schemas/workspace.py) |
| Notebooks | render/watch/clear-watch under `/sessions/{session_id}/notebook` | [notebooks.py](../sidecar/daemon/routers/notebooks.py), [notebook schema](../sidecar/daemon/schemas/notebook.py) |
| Git | diff/branches/checkout under `/sessions/{session_id}/git` | [git.py](../sidecar/daemon/routers/git.py), [git schema](../sidecar/daemon/schemas/git.py) |
| Review/shipping | files/diff/stage/unstage/revert/commit/push/PR/commit-message/default-branch/ship-info under `/sessions/{session_id}/review` | [review.py](../sidecar/daemon/routers/review.py), [review schema](../sidecar/daemon/schemas/review.py) |
| Projects/worktrees | project list/upsert/active selection plus worktree and branch operations under `/projects` | [projects.py](../sidecar/daemon/routers/projects.py), [projects schema](../sidecar/daemon/schemas/projects.py) |
| Memory | `GET /memory/projects, /memory/files, /memory/file`; `PUT /memory/file`; `POST /memory/search` | [memory.py](../sidecar/daemon/routers/memory.py), [memory schema](../sidecar/daemon/schemas/memory.py) |
| Event stream | `GET /events/stream?token=...` | [events.py](../sidecar/daemon/routers/events.py); SSE envelope described below |

All HTTP, validation, reader, service, and unexpected failures use the shared
[ErrorEnvelope](../sidecar/daemon/schemas/error.py):

```json
{
  "code": "SESSION_BUSY",
  "domain": "optional-domain",
  "path": "optional-path",
  "detail": "optional-safe-detail",
  "trace_id": "request-trace-id"
}
```

Optional fields are omitted. The status mapping lives in `app.py`; for example,
an already-running session returns `SESSION_BUSY` with HTTP `409`. A
`MEMORY_CONCURRENT_WRITE` response additionally includes the current file to
support a merge UI.

## SSE event stream

The client opens:

```text
GET /desktop/api/events/stream?token=<url-encoded-api-token>
```

Native `EventSource` cannot attach the REST bearer header, so
[sse-lifecycle.ts](../src/services/gateway/http/sse-lifecycle.ts) puts the
ephemeral token in the query string. Treat the URL as secret: do not log,
persist, or expose it to renderer state. One connection is multiplexed across
sessions. The server sends a keepalive comment every 15 seconds and each data
frame is one JSON envelope:

```json
{
  "session_id": "session-id",
  "seq": 42,
  "type": "tool.complete",
  "payload": { "tool_id": "tool-1", "name": "read_file" }
}
```

`session_id` selects the session, `type` selects the event decoder, and
`payload` is type-specific. The normalized payload authority is
`GatewayEventMap`; concrete payload interfaces are imported from
`src/types/index.ts`. The [HTTP adapter](../src/services/gateway/http-adapter.ts)
normalizes raw aliases such as `turn_error` to the renderer `error` event and
ignores persistence-only `user` and `turn.core_user_message` frames.

The renderer event surface is complete in these groups:

| Group | `GatewayEventMap` event types | Transport note |
| --- | --- | --- |
| Lifecycle/session | `gateway.ready`, `session.info`, `session.title_update`, `model.changed`, `turn.interrupted`, `session.rewind` | `gateway.ready` is emitted locally on SSE open; `session.info` is shared adapter compatibility and session method payload; the remainder can arrive from SSE. |
| Assistant text/planning | `message.start`, `message.delta`, `message.complete`, `plan.delta`, `plan.complete`, `thinking.delta`, `reasoning.delta`, `reasoning.available`, `status.update` | The HTTP adapter currently maps all listed events except reserved cross-adapter `thinking.delta` and `reasoning.available`. |
| Tools | `tool.start`, `tool.progress`, `tool.generating`, `tool.complete`, `tool.error` | Positive sequence numbers participate in replay/deduplication. |
| Interactive requests | `approval.request`, `clarify.request`, `user_input.request`, `user_input.response`, `sudo.request`, `secret.request` | Pending approval and durable user-input requests are replayed by the stream endpoint after reconnect. |
| Background/UI | `background.complete`, `btw.complete`, `notebook.changed` | Notebook markers may set `deferred` so the client re-fetches render data. |
| Delegation | `subagent.start`, `subagent.progress`, `subagent.complete`, `subagent.tool`, `subagent.error` | Payloads identify both owning session and subagent. |
| Failure/diagnostics | `error`, `gateway.stderr`, `gateway.protocol_error` | Raw `turn_error` is normalized to `error`; safe diagnostic strings only. |

### Sequence, loss, and reconnect rules

- Positive `seq` values are durable and monotonic per session, not globally.
  The adapter accepts a positive event only when its sequence is strictly
  greater than the last accepted sequence for that session. Duplicate and
  older frames are discarded.
- `seq: 0` means ephemeral or special replay data and does not advance the
  durable cursor. Global events may use an empty `session_id`; the HTTP adapter
  only routes events it can associate with a session.
- On an EventSource error the adapter enters `reconnecting`. When the browser
  reopens the stream, the sidecar first replays pending path approvals and
  pending durable `user_input.request` prompts.
- On every open, the adapter also replays each known session with
  `GET /desktop/api/sessions/{session_id}/messages?since={lastSeq}` and dispatches
  only rows strictly newer than the saved per-session cursor. This repairs a
  disconnect or the event bus's bounded per-subscriber queue, which keeps 256
  entries and drops the oldest under backpressure.
- Replay is idempotent because live and replayed positive frames pass through
  the same per-session sequence gate. Deleted sessions are ignored during
  reconnect replay.

## Session and profile concurrency

The sidecar allows one active turn per session. A second
`POST /desktop/api/prompt/execute` for the same session returns `409
SESSION_BUSY`; cwd, archive, rewind, and related mutations also guard a running
session where required. Separate sessions can run independently within one
Studio process.

The active profile is process-wide. Studio and the separate app in
`apps/desktop` can point at the same Hermes profile, but there is no cross-app
lock around profile/config changes or session turns. Concurrently controlling
the same session is unsupported; use separate profiles for concurrent testing,
or at minimum separate sessions and avoid simultaneous profile mutation.
