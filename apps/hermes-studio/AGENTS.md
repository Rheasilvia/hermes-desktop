# Hermes Studio contributor guide

This file scopes work under `apps/hermes-studio`. The repository-level
[`AGENTS.md`](../../AGENTS.md) still applies.

## Architecture authority

Hermes Studio is an Electron application with a SolidJS renderer and a
Studio-owned Python sidecar. Read these documents before changing a boundary:

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — processes, trust
  boundaries, lifecycle, and runtime data flow.
- [`docs/NATIVE_BRIDGE.md`](./docs/NATIVE_BRIDGE.md) — frozen
  `window.hermesStudio` surface and native capability ledger.
- [`docs/API_CONTRACTS.md`](./docs/API_CONTRACTS.md) — sidecar REST and SSE
  contract.
- [`docs/decisions/ADR-001-electron-shell.md`](./docs/decisions/ADR-001-electron-shell.md)
  — host decision and alternatives.
- [`DESIGN.md`](./DESIGN.md) — renderer design system and interaction rules.
- [`docs/RELEASE.md`](./docs/RELEASE.md) — packaging and release validation.

`apps/desktop` is a separate upstream React application. It may be studied as a
reference, but Studio must not import its renderer, state, or runtime modules.

## Boundaries

- Electron main owns native capabilities and the sidecar process.
- Preload exposes only narrow, typed methods on `window.hermesStudio`.
- The renderer must not receive Node.js, raw Electron APIs, unrestricted paths,
  generic IPC, or production backend credentials.
- Keep HTTP/SSE behavior behind the existing API and gateway adapter layers.
- Prefer small feature-owned SolidJS stores and explicit dependencies.
- Keep release behavior host-native and verify packaged artifacts, not only
  mocked unit paths.
- Historical documents under `docs/history` are context only. Their
  architecture and paths are not current instructions.

## Commands

Run commands from `apps/hermes-studio`:

```bash
npm run dev
npm run build
npm run pack
npm run dist
npm run typecheck
npm run lint
npm run test
npm run test:e2e
npm run docs:check
```

Run focused tests before broad suites. Native bridge or packaging changes also
need the Electron boundary tests and the packaged smoke checks documented in
`docs/RELEASE.md`. Sidecar changes need the relevant pytest unit/integration
path against the real app factory where practical.

## Documentation

Update the canonical document that owns the changed contract. Add an ADR when
a decision changes architecture, security posture, persistence, protocol, or
packaging direction. Do not turn a historical record back into active guidance;
write current behavior in the canonical docs and keep the record superseded.
