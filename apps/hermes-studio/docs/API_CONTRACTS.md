# Hermes Studio Sidecar API Contracts

The Electron migration preserves the existing `/desktop/api` REST and SSE
routes and their payloads. Task 2 changes only how the local process is bound,
discovered, authenticated, and supervised.

The sidecar binds `127.0.0.1` only. Browser CORS access is an exact allow-list:

- `hermes-studio://app` for packaged Hermes Studio;
- `http://localhost:1420` for browser/Playwright development;
- `http://127.0.0.1:1420` for Electron development.

Other localhost ports, arbitrary HTTP origins, and historical Tauri origins are
not accepted. Requests continue to use `Authorization: Bearer <api-token>`.
Workspace authorization additionally uses `X-Desktop-Workspace-Grant`; that
grant is generated and retained by Electron main and is not renderer data.

## Renderer discovery and authentication

Every REST call, including desktop state load/save, flows through the shared
`HttpClient`. In Electron the client discovers `{baseUrl, token}` only through
`window.hermesStudio.backend.info()` and sends the token as the bearer header.
The bridge's presence is authoritative: if native discovery rejects, the
request fails closed instead of trying browser variables or a default port.

`backend.onReady` and `backend.onRestarted` replace the cached URL/token before
background stores reload. A `401` performs one forced native rediscovery and
one retry; loopback network reads keep their existing bounded retry policy.

When the bridge is absent, non-production browser development and Playwright
may provide both `VITE_SIDECAR_URL` and `VITE_SIDECAR_TOKEN`. Production builds
ignore that fallback and `.env.production` contains no baked endpoint or
credential. Playwright's server script starts `npm run dev:renderer`, so its
mock/browser path cannot accidentally launch Electron.
