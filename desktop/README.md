# Hermes Desktop

A Tauri v2 desktop application built with SolidJS and TypeScript, serving as the UI client for the Hermes AI agent system.

## Features

- **Chat Interface**: Real-time streaming chat with AI agents, tool call visualization, and session management
- **Usage Analytics**: Comprehensive model usage statistics with cost tracking, token analysis, and period-based reporting
- **Model Management**: Provider configuration, model selection, and custom endpoint support
- **Settings Management**: Full configuration UI for agent, security, memory, voice, and browser settings
- **Skills & Tools**: Built-in skills hub with tool browsing and management
- **Memory System**: Context file management and memory search capabilities
- **Gateway Integration**: Python backend communication via typed adapter interface
- **Standalone Architecture**: Desktop-owned Python sidecar with no runtime dependency on upstream modules

## Setup

```bash
cd desktop
npm install
```

## Development

```bash
npm run dev          # Start Vite dev server (port 1420)
npm run tauri:dev   # Start Tauri development mode with Rust backend
```

## Build

```bash
npm run build        # Build production frontend
npm run tauri:build # Build complete Tauri application
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
npm run type-check    # Run TypeScript type checking
npm run lint          # Run ESLint on src/
```

## Architecture

Hermes Desktop uses a **Gateway Adapter Pattern** where all communication with the Python backend goes through typed interfaces. The application consists of:

- **Frontend**: SolidJS with TypeScript, Vite build system, and modular CSS
- **Desktop Shell**: Tauri v2 (Rust) providing native platform integration
- **Backend**: Python sidecar (`desktop_backend`) serving as the API layer
- **State Management**: SolidJS stores with dependency injection
- **Testing**: Vitest for unit tests, Playwright for E2E tests

See [CLAUDE.md](./CLAUDE.md) for detailed architecture documentation and [DESIGN.md](./DESIGN.md) for design system specifications.

## Documentation

- [CLAUDE.md](./CLAUDE.md) - Developer guide and architecture overview
- [DESIGN.md](./DESIGN.md) - Design system and UI specifications
- [docs/ANALYTICS.md](./docs/ANALYTICS.md) - Usage analytics feature documentation
