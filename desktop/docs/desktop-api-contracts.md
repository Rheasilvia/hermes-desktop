# Desktop API Contract Inventory

This table is the stage-one source of truth for Tauri desktop resource APIs.
Electron is only a reference for capability parity; the implementation below
targets `desktop/`.

| Capability | Sidecar routes | Schema | Frontend transport | UI consumer | Gateway usage |
| --- | --- | --- | --- | --- | --- |
| Cron | `GET /desktop/api/cron/jobs`, `GET /desktop/api/cron/jobs/{id}`, `POST /desktop/api/cron/jobs`, `PATCH /desktop/api/cron/jobs/{id}`, `DELETE /desktop/api/cron/jobs/{id}` | `daemon.schemas.cron` | `services/api/transports/http/cron.ts` | `features/cron/CronView.tsx`, `stores/cron.ts` | Compatibility only |
| MCP | `GET /desktop/api/mcp/servers`, `POST /desktop/api/mcp/servers`, `PATCH /desktop/api/mcp/servers/{name}/desktop`, `DELETE /desktop/api/mcp/servers/{name}`, `GET /desktop/api/mcp/servers/{name}/tools`, `POST /desktop/api/mcp/reload` | `daemon.schemas.mcp`; config in `config.yaml`, desktop meta in `desktop.db`; list/tools are status-only and reload is explicit | `services/api/transports/http/mcp.ts` | `features/mcp/McpView.tsx`, `pages/McpPage.tsx` | Compatibility only |
| Skills | `GET /desktop/api/skills`, `PUT /desktop/api/skills/toggle` | `daemon.schemas.skills` | `services/api/transports/http/skills.ts` | `features/skills/SkillsView.tsx` | Compatibility only |
| Toolsets | `GET /desktop/api/toolsets` | `daemon.schemas.skills` | `services/api/transports/http/skills.ts` | `features/skills/SkillsView.tsx` | None |
| Tools | `GET /desktop/api/tools`, `POST /desktop/api/tools/reload` | `daemon.schemas.tools` | `services/api/transports/http/tools.ts` | Gateway compatibility / future UI | Compatibility only |

Resource pages should call `services/api` transports directly. `GatewayAdapter`
is kept for realtime chat, SSE, prompt, approval/clarify/sudo/secret, slash,
and command compatibility, plus thin compatibility wrappers for older callers.
