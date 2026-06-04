# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hermes Desktop is a Tauri v2 desktop application that serves as the UI client for the Hermes AI agent system. It is built with SolidJS and TypeScript, and communicates with a Python backend (the Hermes gateway) via a typed adapter interface.

## Tech Stack

- **Frontend**: SolidJS, TypeScript, Vite, @solidjs/router
- **Desktop shell**: Tauri v2 (Rust)
- **Testing**: Vitest (unit, jsdom), Playwright (E2E)
- **Linting**: ESLint v9 with @typescript-eslint

## Common Commands

All commands run from the `desktop/` directory:

```bash
# Development
npm run dev           # Vite dev server (port 1420)
npm run backend       # Python backend (port 18080, dev token)
npm run tauri:dev     # Tauri dev mode with Rust backend

# Build
npm run build         # Production frontend build
npm run tauri:build   # Build the full desktop application

# Quality
npm run type-check    # tsc --noEmit
npm run lint          # ESLint on src/

# Testing
npm run test          # Vitest unit tests
npm run test:watch    # Vitest in watch mode
npm run test:coverage # Vitest with Istanbul coverage
npm run test:e2e      # Playwright E2E tests
npm run test:e2e:ui   # Playwright tests with UI
```

Playwright E2E tests automatically start the Vite dev server (`npm run dev`) as a webServer.

## High-Level Architecture

### Gateway Adapter Pattern

The frontend does not call APIs directly. All communication with the Python backend goes through the `GatewayAdapter` interface defined in `src/services/gateway/types.ts`. This interface exposes typed method groups (session, prompt, config, tools, model, approval, clarify, sudo, secret, cron, mcp, memory, skills, complete, slash, command, **analytics**) and an event emitter for streaming events (message deltas, tool calls, reasoning, errors, etc.).

There are two implementations:
- `GatewayClient` — wraps a real `Transport` for JSON-RPC communication with the Python gateway.
- `MockGatewayAdapter` — fully functional mock with realistic data, used for frontend development when the backend is not running.

The newer **API Transport Pattern** (`src/services/api/`) provides HTTP-based communication for specific features:
- **Analytics Transport** — fetches model usage statistics and cost data
- Each transport has HTTP and mock implementations for testing

Stores obtain the gateway instance via dependency injection in `src/stores/context.ts` (`initializeStores` / `getGateway`).

### Store Pattern

State management uses SolidJS `createSignal` in module-level stores under `src/stores/`. There is no global store library. Key stores:
- `chat.ts` — per-session message state, streaming, tool calls
- `session.ts` — session list, active session, CRUD
- `settings.ts` — config loading/saving
- `ui.ts` — sidebar, theme, connection state (persists to localStorage)
- `models.ts` — model state, active provider/model selection
- `analytics.ts` — usage statistics, cost tracking, period management
- `cron.ts` — scheduled job management

### Application Shell

- `src/index.tsx` — entry point
- `src/App.tsx` — root component with `@solidjs/router`, lazy-loaded pages, and `AppLayout`
- `src/shell/AppLayout.tsx` — main shell (sidebar + content area)
- `src/shell/bootstrap.ts` — initialization logic (theme, settings, sidecar)
- `src/routes.ts` — route path constants

Pages are lazy-loaded with `Suspense` and wrapped in `ModuleErrorBoundary`.

### Feature Modules

Each major feature lives in `src/features/<feature>/` containing view components and CSS modules:
- `conversation/` — streaming chat interface, message bubbles, input, tool call rendering
- `sessions/` — session list, cards, detail views
- `settings/` — settings tabs (General, Agent, Security, Memory, Voice, Browser, YAML)
- `model/` — model selection, provider management, **usage analytics dashboard**
- `skills/` — skills hub, tool lists
- `mcp/` — MCP server management
- `memory/` — memory search, context files, user profile
- `gateway/` — connection status, setup wizard, message log
- `cron/` — scheduled job management

#### Analytics Module

The `model/` feature now includes comprehensive usage analytics:
- **ModelUsageView** — main analytics dashboard with period selection (7/30/90 days)
- **ModelUsageCard** — individual model statistics with session counts, token usage, costs
- **UsageSummaryBar** - aggregated totals across all models with period switching
- Data includes: session counts, input/output tokens, costs, last used timestamps, model capabilities
- Integrates with `analyticsStore` for state management and API communication

### UI Components and Design System

UI components follow Atomic Design in `src/ui/`:
- `ui/atoms/` — minimal primitives (Button, Input, Select, Toggle, Badge, Pill, Icon, LoadingSpinner, etc.)
- `ui/molecules/` — composed components (Card, Modal, Tabs, Toast, SearchInput, EmptyState)
- `ui/organisms/` — complex visual components (AsciiBanner, HermesLogo)
- `shell/` — app-level components (AppLayout, Sidebar, CommandPalette, StatusBar, TitleBar)

Styles use CSS Modules for components and global CSS custom properties for the design system (`src/styles/tokens.css`). Three themes (`light`, `dark`, `earth`) are toggled via the `data-theme` attribute on `<html>`. The default theme is `earth`. Typography uses Newsreader (serif headings), Inter (body), and IBM Plex Mono (code). See `DESIGN.md` for the full design specification.

### Tauri Rust Backend

The Rust layer in `src-tauri/` provides:
- File system commands scoped to `HERMES_HOME`
- Platform detection, external URL opening, process spawning
- Auto-updater via GitHub Releases
- Single-instance enforcement
- Sidecar management: dev mode connects to pre-running backend, prod mode spawns bundled binary

### Python Backend

The standalone Python backend in `sidecar/daemon/` serves the desktop API:
- **Config**: Env-var driven (`DESKTOP_BACKEND_PORT`, `DESKTOP_BACKEND_TOKEN`). Dev defaults: port 18080, token `dev-secret`. Prod defaults: port 18081, token `prod-secret`.
- **Auth**: Bearer token via `Authorization` header. Skipped when token is not configured.
- **Model providers**: Mirrors the dashboard's `list_authenticated_providers()` logic — reads credentials from `~/.hermes/auth.json` credential pool, environment variables (via `PROVIDER_REGISTRY`), and `models_dev_cache.json`. Curated model lists parsed from `hermes_cli/models.py` via AST.
- **Sidecar health**: Rust sidecar health probe monitors `/desktop/api/health` and restarts with backoff on failures.

### Path Aliases

The `@/` alias resolves to `src/` in both Vite and Vitest configurations.

### TypeScript Configuration

- `jsx: "preserve"` with `jsxImportSource: "solid-js"`
- `moduleResolution: "bundler"`
- Strict mode enabled
