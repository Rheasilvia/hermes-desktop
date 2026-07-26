# Hermes Studio

An Electron desktop application built with SolidJS and TypeScript, serving as the UI client for the Hermes AI agent system.

## Features

- **Chat Interface**: Real-time streaming chat with AI agents, tool call visualization, and session management
- **Usage Analytics**: Comprehensive model usage statistics with cost tracking, token analysis, and period-based reporting
- **Model Management**: Provider configuration, model selection, and custom endpoint support
- **Settings Management**: Full configuration UI for agent, security, memory, voice, and browser settings
- **Skills & Tools**: Built-in skills hub with tool browsing and management
- **Memory System**: Context file management and memory search capabilities
- **Gateway Integration**: Python backend communication via typed adapter interface
- **Independent App Surface**: Studio-owned sidecar and UI that reuse the shared Hermes agent core without importing the separate Desktop renderer
- **Secure Native Host**: Typed `window.hermesStudio` bridge with isolated Electron main/preload processes

## Installation

Source prerequisites are Node.js 20 or newer, Python 3.12, `uv`, and the native
build tools for the current operating system. From the repository root:

```bash
cd apps/hermes-studio
npm install
uv sync --directory sidecar --frozen --extra dev --extra build
```

For a local unpacked installation/smoke target, run `npm run pack` and launch
the application generated under `release/`. To build an installer on the
current matching host, use one of:

```bash
npm run dist:mac    # macOS DMG
npm run dist:win    # Windows NSIS installer
npm run dist:linux  # Linux AppImage, deb, and rpm
```

`npm run dist` selects the current host's configured target. Packages produced
by ordinary local or pull-request builds are unsigned internal builds and may
trigger operating-system warnings; publication requires the signing and native
acceptance gates in [the release guide](./docs/RELEASE.md).

## Development

```bash
npm run dev          # Start Vite and Electron (port 1420)
```

## Build and test commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Build the Solid renderer, Electron main/preload, and native dependency staging. |
| `npm run pack` | Build the sidecar and current-host unpacked application. |
| `npm run dist` | Build the current-host installer target. |
| `npm run dist:mac` | Build a macOS DMG on a matching macOS architecture. |
| `npm run dist:win` | Build a Windows x64 NSIS installer on Windows. |
| `npm run dist:linux` | Build Linux x64 AppImage, deb, and rpm packages on Linux. |
| `npm run typecheck` | Check the renderer and Electron TypeScript projects. |
| `npm run lint` | Run ESLint on renderer and Electron sources. |
| `npm run test` | Run Vitest plus packaging-script unit tests. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:coverage` | Run Vitest with Istanbul coverage. |
| `npm run test:e2e` | Run browser-renderer Playwright tests. |
| `npm run test:e2e:ui` | Run browser-renderer Playwright tests with the UI. |
| `npm run test:packaged` | Build and launch the real current-host package, then smoke-test preload, sidecar, PTY, resources, and shutdown. |
| `npm run docs:check` | Validate canonical documentation, source coverage, links, and commands. |

## Architecture

Hermes Studio uses a **Gateway Adapter Pattern** where all communication with the Python backend goes through typed interfaces. The application consists of:

- **Frontend**: SolidJS with TypeScript, Vite build system, and modular CSS
- **Desktop Shell**: Electron main and preload processes
- **Backend**: Python sidecar (`daemon`) serving as the API layer
- **State Management**: SolidJS stores with dependency injection
- **Testing**: Vitest for unit tests, Playwright for E2E tests

Electron main owns the sidecar, filesystem, PTY, clipboard, notifications, and
OS integration. Preload exposes only the frozen
[`window.hermesStudio`](./docs/NATIVE_BRIDGE.md) contract; the renderer never
receives Node, raw Electron APIs, or a generic IPC primitive. The renderer uses
a small native-host adapter for bridge detection and test injection. Browser
development and Playwright run the Vite renderer without Electron and may use
explicit development-only sidecar variables; a present Electron bridge is
always authoritative and packaged builds contain no backend URL or token.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the current host
architecture and [DESIGN.md](./DESIGN.md) for design system specifications.
The host choice and alternatives are recorded in
[ADR-001](./docs/decisions/ADR-001-electron-shell.md).

## Relationship to Hermes Desktop

This repository contains two desktop products. They share Hermes core concepts
and can use the same `HERMES_HOME`, but they do not share a renderer, native
bridge, backend transport, installation identity, or local UI state.
The official Hermes Desktop in `apps/desktop` is a separate application, not a
Studio fallback or runtime dependency.

| | Hermes Studio | Hermes Desktop |
| --- | --- | --- |
| Source | `apps/hermes-studio` | `apps/desktop` |
| Renderer | SolidJS workbench | React + assistant-ui chat client |
| Backend contract | Studio sidecar over authenticated REST/SSE | Headless `hermes serve` over JSON-RPC/WebSocket |
| Native contract | Frozen `window.hermesStudio` preload API | Desktop-owned Electron preload/IPC surface |
| Install identity | `com.hermes-agent.studio`, “Hermes Studio” | `com.nousresearch.hermes`, “Hermes” |
| Local UI data | Dedicated `hermes-studio-electron` user-data directory and `hermes.studio.*` keys | Independent Desktop user-data directory and keys |

Both applications may be installed and launched independently. Studio does not
migrate, delete, or import Desktop UI state. Runtime sessions/config may still
be visible to both when they select the same Hermes profile. One Studio process
allows only one active turn per session; a second same-session turn returns
`SESSION_BUSY` (`409`). Cross-app locking is not provided, so concurrently
controlling the same session is unsupported, and simultaneous profile/config
writes are unsafe. Use separate profiles for concurrent app testing, or at
minimum separate sessions and avoid changing the shared profile at the same
time.

## Troubleshooting

- If startup or REST/SSE connection fails, inspect
  `~/.hermes/logs/hermes-studio.log` (or the selected profile's equivalent),
  then retry `npm run dev`; Electron owns sidecar restart and endpoint changes.
- If an unpacked app works but an installer does not, run
  `npm run test:packaged`. It checks the frozen preload bridge, packaged
  PyInstaller sidecar, `node-pty`, resource paths, executable modes, and clean
  shutdown against the actual app bundle.
- If native modules fail to load, remove no shared repository files. Re-run
  `npm install` and `npm run pack` on the target OS/architecture so `node-pty`
  and the sidecar are rebuilt for that exact host.
- If macOS or Windows blocks a local package, verify whether the package
  contains `resources/INTERNAL-BUILD.txt`. Internal builds are deliberately
  unsigned; use a trusted signed release rather than bypassing organization
  policy.
- If a prompt returns `409 SESSION_BUSY`, let the current turn finish or
  interrupt it. Do not open the same Hermes session in both desktop products.

## Documentation

- [AGENTS.md](./AGENTS.md) - Scoped contributor guidance and verification commands
- [CLAUDE.md](./CLAUDE.md) - Short pointer to canonical contributor guidance
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Electron host architecture and trust boundaries
- [docs/NATIVE_BRIDGE.md](./docs/NATIVE_BRIDGE.md) - Frozen renderer bridge contract and capability ledger
- [docs/API_CONTRACTS.md](./docs/API_CONTRACTS.md) - Sidecar REST and SSE contract
- [docs/decisions/ADR-001-electron-shell.md](./docs/decisions/ADR-001-electron-shell.md) - Electron shell decision and consequences
- [docs/RELEASE.md](./docs/RELEASE.md) - Host-native build and release verification
- [DESIGN.md](./DESIGN.md) - Design system and UI specifications
- [docs/ANALYTICS.md](./docs/ANALYTICS.md) - Usage analytics feature documentation
