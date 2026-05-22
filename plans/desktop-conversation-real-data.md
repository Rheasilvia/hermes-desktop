# Plan: Desktop Conversation — Mock → Real Data

> **Status:** Approved. To be executed by downstream agents (likely split across backend Python and frontend TS specialists).

---

## Notes for Executing Agents (READ FIRST)

1. **Task order is intentional.** Do Tasks 1→8 in order. Task 5 depends on Tasks 1–4 being landed and exercised by their own tests; Tasks 6–7 cannot integration-test until backend tasks are merged.
2. **Two source trees are involved.** Backend Python under `desktop/backend/desktop_backend/`. Frontend TS under `desktop/src/`. A single PR per task is fine; do **not** mix backend + frontend in the same task unless the task explicitly says so.
3. **Do not modify `tui_gateway/` or `hermes/` core.** The whole point is that desktop_backend imports them as a library. If you find yourself wanting to patch them, stop and surface the constraint instead.
4. **Do not change `MockGatewayAdapter` semantics beyond what Task 8 specifies** (`session.interrupt` arity). All other mock behavior must remain bit-identical so `VITE_GATEWAY_MODE=mock` is a true regression-free fallback.
5. **`ui_messages` payload shapes are the contract.** They mirror `desktop/src/types/gateway.ts`. If a backend Pydantic model and the TS type disagree, the TS type wins (it's what existing stores already consume). Update the Pydantic model, not the TS type.
6. **Idempotency matters everywhere.**
   - DB migration in Task 1 must be idempotent (re-running on startup is fine).
   - Context normalizer in Task 3 must be idempotent (`normalize(normalize(x)) == normalize(x)`).
   - SSE replay in Task 7 must produce no duplicates (use strict `seq > lastSeq`).
7. **Concurrency model:** every `prompt.execute` runs in a daemon thread. Inside the thread, agent callbacks fire on that thread. When publishing to the asyncio event bus, use `loop.call_soon_threadsafe`. Do **not** call `asyncio.run()` from a worker thread.
8. **Pin running agents.** `AgentPool` LRU eviction must never evict an agent whose session has `running=True`. Test this explicitly.
9. **Errors must surface as `ui_messages` rows.** A provider exception or interrupt must produce a `turn_error` row (and emit `turn.error` via SSE). Never let a turn end silently; the UI relies on a terminal event per turn.
10. **Write the SSE event **after** the DB insert, never before.** Order: `db.append() -> seq` → `bus.publish(seq, ...)`. This is what guarantees SSE-loss is recoverable from DB.
11. **`session.create` is now real.** A new session ID returned by `POST /sessions` must immediately satisfy `POST /prompt/execute` against the same id. No race.
12. **Inner mock in `HttpGatewayAdapter` runs in degraded mode.** Do not call its `connect()`. Do not let its synthetic streaming events bleed into the real event bus. It exists only as a static method registry for unmigrated method groups (settings/models/skills/mcp/memory/cron).
13. **Contract test is mandatory.** Task 6 includes a test that boots real backend, runs a minimal turn, and diffs SSE payloads against `desktop/src/types/gateway.ts`. Skipping this lets payload drift in silently — do not.
14. **Acceptance checklist at the bottom is the gate.** Every item must be a green check before declaring the plan done. CI does not check all of them; some are manual (kill-and-restart backend test).
15. **Blast radius:** all changes are additive except `App.tsx`, `chat.ts` (handleTurnError + replay), and `types.ts` (interrupt arity). Anything else that needs modification is a red flag — surface before changing.

---

## Context

Hermes Desktop (`desktop/`) currently boots with `createMockGateway()` in `desktop/src/App.tsx:32`. All conversation UI (ChatView, streaming, tool calls, approval/clarify, reasoning) is driven by `MockGatewayAdapter` reading JSON fixtures.

We migrate the **conversation core flow** to real data while keeping desktop independent of `tui_gateway` (PTY/TUI-coupled). The strategy:

1. Extend the existing **desktop_backend** FastAPI sidecar (port 18080) into a thin HTTP+SSE wrapper that imports `hermes` agent classes and `hermes_state.SessionDB` directly. No `tui_gateway` import.
2. Adopt a **two-layer message model**: `ui_messages` (everything the UI needs to render, including intermediate states and errors) is the source of truth for UI; `llm_messages` (the existing hermes history) is what's sent to the model.
3. **SSE is an optimization, SQLite is truth.** The UI always reconciles from `ui_messages` on connect/reconnect; SSE only reduces latency for live deltas. Dropped events do not corrupt state.
4. Borrow Claude Code's `normalizeMessagesForAPI` pattern: run a **context normalizer** before every agent turn so partial/interrupted history can never produce an invalid LLM request.
5. Mock stays as a switchable mode via `VITE_GATEWAY_MODE=mock|http` for offline dev, demos, tests.

**Out of scope (still mock):** settings, models, skills, MCP, memory, cron. **`session.*` (create/list/rename/delete/info/messages/interrupt) is in scope** — the entire session method group switches to real, since `prompt.execute` requires real session rows and partial mock+real session state would diverge.

## Architectural Decisions

1. **Transport:** HTTP REST for request/response (`session.*`, `prompt.execute`, `approval.respond`, `clarify.respond`) + one long-lived SSE stream for live UI message append events. All events multiplexed; each carries `session_id` and `seq`.
2. **Two-layer messages:**
   - `ui_messages(session_id, seq, type, payload_json, created_at)` — append-only log of everything the UI renders. `type ∈ {user, assistant_text_delta, assistant_text_final, reasoning_delta, tool_call_start, tool_call_progress, tool_call_complete, tool_call_error, approval_request, clarify_request, turn_error}`. Stored in a **separate** `~/.hermes/desktop_ui.db` so desktop UI state is fully decoupled from the hermes core DB.
   - `llm_messages` — the existing hermes history table (`hermes_state.SessionDB`), unchanged. Written at turn completion in canonical provider format.
3. **SSE as cache-warming, not source of truth:** every SSE event is the projection of a row just inserted into `ui_messages`. On reconnect, frontend calls `GET /sessions/{sid}/messages?since={last_seq}` to catch up. Lost events are recoverable from DB without `Last-Event-ID` replay.
4. **Context normalizer (claude-code pattern):** before every `agent.run(...)`, normalize `llm_messages` to ensure validity — orphan `tool_use` gets a synthetic `tool_result: {is_error: true, content: "interrupted"}`, orphan `tool_result` is dropped, consecutive same-role messages merged. Makes "streaming interrupted = turn fails" safe — the next turn auto-repairs.
5. **Adapter swap, not store rewrite:** add `HttpGatewayAdapter implements GatewayAdapter`. Stores and components unchanged. `MockGatewayAdapter` stays for `mode=mock`.
6. **Agent lifecycle:** `AgentPool.get_or_create(sid)` lazy-creates one `AIAgent` per session; LRU cap (8) + 30-min idle eviction; **running agents are pinned and never evicted**. Each `prompt.execute` runs in a daemon thread (mirrors `tui_gateway/server.py:3080`).
7. **Reuse hermes core directly:** `from agent.agent_init import init_agent`, `from hermes_state import SessionDB`. No `tui_gateway` dependency.

## Patterns to Mirror

| Category | Source | Pattern |
|---|---|---|
| HTTP transport | `desktop/src/services/api/http-client.ts` | Bearer auth, retry, sidecar URL via Tauri `sidecar_info` |
| Mock/HTTP twin | `desktop/src/services/api/transports/{http,mock}/analytics.ts` | Adapter selected by env var |
| Adapter interface | `desktop/src/services/gateway/types.ts`, `mock-adapter.ts` | `GatewayAdapter` method groups + event emitter |
| Streaming callbacks | `tui_gateway/server.py:1559` (`_emit("tool.start", ...)`), `:3300` (`message.delta`) | Same payload shapes, delivered over SSE |
| Turn-level error | `tui_gateway/server.py:3068-3079` (`_emit("error", sid, ...)` + clear `running`) | Same pattern as `turn_error` ui_message |
| Lazy agent build | `tui_gateway/server.py:2145` (`session.create` returns immediately, agent built 50ms later) | `AgentPool.get_or_create` async build |
| Per-turn thread | `tui_gateway/server.py:3080` (`threading.Thread(target=..., daemon=True)`) | Same in `prompt.execute` |
| Agent callbacks | `agent/agent_init.py:169` (`tool_start_callback`, `reasoning_callback`, `stream_delta_callback`) | Wire to `ui_messages.append` + bus publish |
| SQLite reader | `hermes_state.py:310` (`SessionDB`), `:1912` (`get_messages_as_conversation`) | Direct use; ui_messages lives in a separate DB |
| Message normalizer | `claude-code-source-code/src/utils/messages.ts:1989` (`normalizeMessagesForAPI`) | Full port to Python |

## Files to Change

### Backend (`desktop/backend/desktop_backend/`)

| File | Action | Why |
|---|---|---|
| `db/ui_messages.py` | CREATE | DAO for the `ui_messages` table in a separate `~/.hermes/desktop_ui.db`. `append(sid, type, payload) -> seq`, `list(sid, since_seq=None)`, `latest_seq(sid)`, idempotent schema migration on startup |
| `services/event_bus.py` | CREATE | In-process pub/sub. Backend publishes `(session_id, seq, type, payload)`. Thread→asyncio bridge via `loop.call_soon_threadsafe`. Fan-out to all subscribers (multi-window safe). |
| `services/agent_pool.py` | CREATE | Lazy `AIAgent` cache; LRU(8) + idle eviction; pinned-when-running. Callbacks first insert a `ui_messages` row (obtaining `seq`), then publish to bus. |
| `services/context_normalizer.py` | CREATE | **Full port** of claude-code's `normalizeMessagesForAPI`. Called on `llm_messages` before every `agent.run`. Idempotent. |
| `routers/conversations.py` | UPDATE | Endpoints: `POST /sessions`, `GET /sessions`, `PATCH /sessions/{sid}`, `DELETE /sessions/{sid}`, `GET /sessions/{sid}`, `GET /sessions/{sid}/messages?since={seq}` (**returns ui_messages rows in the same shape as SSE events**), `POST /prompt/execute`, `POST /sessions/{sid}/interrupt`, `POST /approval/respond`, `POST /clarify/respond` |
| `routers/events.py` | CREATE | `GET /events/stream` — long-lived SSE, multiplexed; payload `{session_id, seq, type, data}` |
| `app.py` | UPDATE | Mount new routers |
| `tests/integration/test_conversations.py` | CREATE | Posts prompt → drains SSE → asserts `ui_messages` matches the live event stream; asserts normalizer fixes a hand-crafted broken history |

### Frontend (`desktop/src/`)

| File | Action | Why |
|---|---|---|
| `services/gateway/http-adapter.ts` | CREATE | `HttpGatewayAdapter implements GatewayAdapter`. Real impl for the whole `session.*` group plus `prompt.execute`, `approval.respond`, `clarify.respond`. **Falls through to an inner `MockGatewayAdapter`** for settings/models/skills/mcp/memory/cron. Inner mock: `connect()` is **not** called; no synthetic events; static method registry only. SSE via one `EventSource('/desktop/api/events/stream?token=...')` on `connect()`. On error → reconnecting; on reopen → per-session `GET .../messages?since=lastSeq` replay through the same dispatch. |
| `services/gateway/types.ts` | UPDATE | `session.interrupt(sessionId: string)` — mock currently has no arg; align with real backend |
| `services/gateway/mock-adapter.ts` | UPDATE | Match new `interrupt(sessionId)` signature; otherwise unchanged |
| `services/gateway/index.ts` | UPDATE | Export `createHttpGateway(httpClient)` |
| `stores/chat.ts` | UPDATE | Add `handleTurnError` (sets `liveState.status='error'`, `errorMessage`); add `since`-aware replay handler used after reconnect |
| `App.tsx` | UPDATE | Branch on `import.meta.env.VITE_GATEWAY_MODE` (`mock` default, `http` in prod) |
| `.env`, `.env.production` | UPDATE | `VITE_GATEWAY_MODE=mock` / `http` |

## Tasks

### Task 1 — `ui_messages` table + DAO
- **Action:** Create table `ui_messages(session_id TEXT, seq INTEGER, type TEXT, payload_json TEXT, created_at REAL, PRIMARY KEY(session_id, seq))` in `~/.hermes/desktop_ui.db` via idempotent migration on backend startup. DAO: `append`, `list(since_seq=None)`, `latest_seq(sid)`. Cross-DB joins with `llm_messages` are intentionally avoided.
- **Validate:** unit test inserts rows, lists with/without `since`, asserts monotonic `seq` per session.

### Task 2 — Event bus + SSE endpoint
- **Action:** `services/event_bus.py` (per-subscriber `asyncio.Queue`, thread-safe publish). `routers/events.py` returns `text/event-stream`; sends `: keepalive` every 15s; emits `X-Accel-Buffering: no`. Format: `event: {type}\ndata: {"session_id":"...","seq":N,"payload":{...}}\n\n`.
- **Validate:** `curl -N` stays open; pytest publishes → asserts line received; two subscribers both receive the same publish (fan-out).

### Task 3 — Context normalizer
- **Action:** Full port of `claude-code-source-code/src/utils/messages.ts:1989` `normalizeMessagesForAPI`. Covers: tool_use/tool_result pairing (synthetic `is_error` for orphan tool_use, drop orphan tool_result), consecutive same-role merging, empty-message filtering, provider-specific field trimming. Pure function, idempotent.
- **Validate:** unit tests with: (a) interrupted tool call, (b) duplicate tool_result, (c) consecutive assistant messages, (d) `normalize(normalize(x)) == normalize(x)`.

### Task 4 — Agent pool
- **Action:** `AgentPool.get_or_create(sid)`. On create, call `init_agent(...)` with callbacks that **first** insert a `ui_messages` row, **then** publish via bus. LRU(8) + 30-min idle eviction; `running` agents pinned. Each turn started in a daemon thread.
- **Validate:** unit test runs trivial turn with fake provider, asserts `ui_messages` rows + bus events in order; asserts eviction skips a running agent under cap pressure.

### Task 5 — Conversation REST endpoints
- **Action:** Extend `routers/conversations.py`:
  - `POST /sessions {model?, system_prompt?, workspace_path?}` → create SQLite session row, return `{session_id, info}`.
  - `GET /sessions`, `PATCH /sessions/{sid}`, `DELETE /sessions/{sid}`, `GET /sessions/{sid}` — straight pass-throughs to `SessionDB`.
  - `GET /sessions/{sid}/messages?since={seq}` → reads `ui_messages` since seq (or full history when omitted), **returns rows shaped identically to SSE event payloads**.
  - `POST /prompt/execute {message, session_id}` → resolve agent from pool; **call `context_normalizer.normalize(llm_messages)` first**; append user `ui_messages` row; emit `message.start`; run agent in thread; return `202`. Errors during the turn → write `turn_error` `ui_messages` row + emit `turn.error` event + clear `running`.
  - `POST /sessions/{sid}/interrupt`, `POST /approval/respond`, `POST /clarify/respond` → delegate to existing hermes pending-request hooks.
- **Validate:** integration test full happy path + interrupt path + provider-error path; asserts `ui_messages` is the complete record in every case.

### Task 6 — Frontend HttpGatewayAdapter
- **Action:** Implement adapter. Real methods listed above; everything else delegates to an inner `MockGatewayAdapter` in degraded mode (no `connect()`, no synthetic events). SSE via `EventSource` (token via `?token=...`, see Risks). On event, route to existing handler set; `lastSeq: Map<sessionId, number>` tracked in adapter state.
- **Mirror:** event payload contract from `desktop/src/types/gateway.ts`. Add a runtime guard logging unknown event types. **Add a contract test** that boots real backend, runs a minimal turn, dumps all event types/payloads, asserts each field has a TS counterpart.
- **Validate:** Vitest with fake `EventSource` → asserts `chat.ts` handlers update store correctly. Contract test catches drift.

### Task 7 — Reconnect via DB replay
- **Action:** `EventSource.onerror` → `liveState.status='reconnecting'`. `EventSource.onopen` (after auto-reconnect) → for each known session, call `GET /sessions/{sid}/messages?since=lastSeq`; the response is an array of rows shaped identically to SSE event payloads, replayed through the **same** dispatch path. Bump `lastSeq` on every delivered row (live or replay). Strict `since > lastSeq` server-side → no duplicates.
- **Validate:** kill backend mid-stream → UI shows reconnecting → restart → UI catches up to latest state with no missing/duplicate rows.

### Task 8 — Mode switch + interrupt arity
- **Action:** `App.tsx` reads `VITE_GATEWAY_MODE`. Update `GatewayAdapter.session.interrupt` to take `sessionId`; update `MockGatewayAdapter` accordingly. All call sites pass the active session id.
- **Validate:** mock and http modes both work; existing tests pass.

## Validation

```bash
# Backend
cd desktop/backend
uv run pytest tests/integration/test_conversations.py -v
uv run pytest tests/unit/test_context_normalizer.py -v

# Frontend
cd desktop
npm run type-check && npm run lint
npm run test -- gateway/http-adapter

# End-to-end (manual)
# Term A: cd desktop && npm run backend
# Term B: cd desktop && VITE_GATEWAY_MODE=http npm run dev
# In browser: send prompt, observe streaming, tool calls, reasoning;
# kill/restart backend mid-turn, verify recovery.

# Regression:
cd desktop && VITE_GATEWAY_MODE=mock npm run dev   # unchanged behavior
```

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Event payload drift from `gateway.ts` types | Medium | Pydantic models on server mirror TS types; contract test in Task 6 |
| Agent callbacks on worker threads vs asyncio bus | Medium | `loop.call_soon_threadsafe` bridge |
| SSE buffered by Tauri webview / proxy | Low | `: keepalive` every 15s; `X-Accel-Buffering: no` |
| Agent pool memory growth | Low | LRU(8) + idle eviction; running agents pinned |
| EventSource auth on loopback sidecar | Low | sidecar listens only on 127.0.0.1; reuse existing Bearer token in query string |
| `ui_messages` table grows unboundedly | Low | Same lifecycle as `llm_messages`; rely on session cleanup |
| Normalizer changes LLM behavior | Low | Idempotent + unit-tested; off-by-default flag during rollout |
| Streaming-interrupted turn corrupts LLM history | Low | Normalizer fixes on next turn; no in-band repair needed |

## Acceptance

- [ ] `VITE_GATEWAY_MODE=http` loads real session messages, streams real assistant responses with deltas, tool calls, reasoning; approval/clarify round-trips work.
- [ ] `VITE_GATEWAY_MODE=mock` (default in dev) behaves exactly as today; existing Vitest + Playwright suites pass.
- [ ] Reconnect mid-turn: UI shows reconnecting, catches up via DB replay, no duplicate/missing messages.
- [ ] Provider error during a turn produces a visible error in UI and a `turn_error` row in `ui_messages`.
- [ ] Hand-crafted broken `llm_messages` is repaired by normalizer; next turn succeeds.
- [ ] No changes required to `chat.ts` event handlers (beyond `handleTurnError` + replay), `ChatView`, or message components.
- [ ] desktop_backend has zero import from `tui_gateway`.
