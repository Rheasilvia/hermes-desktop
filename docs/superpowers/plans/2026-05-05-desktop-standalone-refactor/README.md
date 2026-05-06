# Desktop Standalone Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor desktop's Model Config + Cron pages to source real data from `~/.hermes/` via a desktop-owned Python sidecar, removing all runtime dependency on `tui_gateway` and other upstream Python modules, while preserving UI/UX.

**Architecture:** A new Python sidecar (`desktop_backend`) runs FastAPI on `127.0.0.1:<dynamic-port>` with a Bearer token from a `0600` file. Tauri's `sidecar.rs` spawns and supervises it. The frontend gets a single egress at `@/services/api` with a router that maps domain calls to HTTP transports. Three-layer config (L1 shared / L2 overlay / L3 desktop-only) is read from `~/.hermes/{cron,cache,desktop}/`.

**Tech Stack:**
- Python 3.11+, FastAPI, Uvicorn, Pydantic v2, pytest, httpx (test), PyInstaller (release)
- Rust (Tauri v2), `tokio` (async runtime), `reqwest` (sidecar health probe)
- TypeScript, SolidJS, Vite, Vitest, Playwright
- ESLint v9 with `no-restricted-imports`

---

## Spec source

This plan implements the spec at:
`docs/superpowers/specs/2026-05-05-desktop-standalone-refactor/`

Read the spec first (00–05 + README.md). Decision codes (D1–D10) and
acceptance criteria referenced in this plan are defined there.

## Plan layout

The plan is split into chunked section files for incremental writing
and review:

1. [`01-sidecar-backend.md`](./01-sidecar-backend.md) — Tasks 1–18:
   Python sidecar skeleton, reader copies, utilities, routers.
2. [`02-tauri-rust.md`](./02-tauri-rust.md) — Tasks 19–22:
   `sidecar.rs` (spawn, READY parsing, token, health, restart).
3. [`03-frontend.md`](./03-frontend.md) — Tasks 23–33:
   `services/api/`, stores, module wiring.
4. [`04-boundaries-packaging.md`](./04-boundaries-packaging.md) —
   Tasks 34–38: ESLint rules, grep CI, PyInstaller, externalBin,
   acceptance verification.

Tasks are numbered globally across files. Each task is self-contained
(file paths, exact code, exact commands). Execute sequentially unless
noted.

## Execution conventions

- **TDD**: every code-producing task pairs a failing test with the
  minimal implementation that makes it pass.
- **Commits**: one commit per task at minimum. Conventional Commits
  format (`feat:`, `test:`, `refactor:`, `chore:`, `docs:`).
- **Working dir**: all `npm` / `pytest` / `python` commands assume the
  cwd noted in each task; respect it.
- **No upstream imports**: any code under `desktop/backend/desktop_backend/`
  importing `hermes_cli`, `cron`, `agent`, `tui_gateway`, or `web` is a
  spec violation (D6). Tests in Task 36 enforce this.

## Status

- [x] Sidecar backend complete (Tasks 1–18)
- [x] Tauri sidecar manager complete (Tasks 19–22)
- [x] Frontend api + stores + modules complete (Tasks 23–33)
- [x] Boundaries + packaging complete (Tasks 34–38)
- [x] Acceptance criteria from `05-implementation-notes.md` met

**COMPLETED 2026-05-06** — All tasks implemented on branch `feat/desktop-standalone`.
