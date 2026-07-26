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
