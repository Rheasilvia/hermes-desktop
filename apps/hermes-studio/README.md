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
- **Standalone Architecture**: Desktop-owned Python sidecar with no runtime dependency on upstream modules
- **Secure Native Host**: Typed `window.hermesStudio` bridge with isolated Electron main/preload processes

## Setup

```bash
cd apps/hermes-studio
npm install
```

## Development

```bash
npm run dev          # Start Vite and Electron (port 1420)
```

## Build

```bash
npm run build        # Build the renderer and Electron processes
npm run dist         # Create the platform package
```

## Testing

```bash
npm run test          # Run Vitest unit tests
npm run test:watch    # Run Vitest in watch mode
npm run test:coverage # Run tests with Istanbul coverage
npm run test:e2e      # Run Playwright E2E tests
npm run test:e2e:ui   # Run Playwright tests with UI
```

## Type Checking & Linting

```bash
npm run typecheck     # Run renderer and Electron TypeScript checks
npm run lint          # Run ESLint on renderer and Electron sources
```

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
receives Node or raw Electron APIs. Renderer call sites are switched from Tauri
to this bridge in the next migration task, so the checked-in Tauri source is
temporarily retained as migration evidence and fallback development code.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the current host
architecture and [DESIGN.md](./DESIGN.md) for design system specifications.

## Documentation

- [CLAUDE.md](./CLAUDE.md) - Developer guide and architecture overview
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) - Electron host architecture and trust boundaries
- [docs/NATIVE_BRIDGE.md](./docs/NATIVE_BRIDGE.md) - Frozen renderer bridge contract and capability ledger
- [docs/RELEASE.md](./docs/RELEASE.md) - Host-native build and release verification
- [DESIGN.md](./DESIGN.md) - Design system and UI specifications
- [docs/ANALYTICS.md](./docs/ANALYTICS.md) - Usage analytics feature documentation
