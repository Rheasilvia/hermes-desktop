<div align="center">

<img src="assets/banner.png" alt="Hermes Desktop" width="100%" />

# Hermes Desktop

A desktop-first fork of [Hermes Agent](https://github.com/NousResearch/hermes-agent), bringing the agent runtime into a native desktop workbench.

[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE) [![Built on Hermes Agent](https://img.shields.io/badge/Built%20on-Hermes%20Agent-FFD700?style=flat-square)](https://github.com/NousResearch/hermes-agent) [![Platform: macOS](https://img.shields.io/badge/Platform-macOS-000000?style=flat-square&logo=apple&logoColor=white)](#) [![Tauri v2](https://img.shields.io/badge/Tauri-v2-blueviolet?style=flat-square)](https://v2.tauri.app) [![SolidJS](https://img.shields.io/badge/SolidJS-frontend-2c4f7c?style=flat-square)](https://www.solidjs.com) [![Python Sidecar](https://img.shields.io/badge/Python-sidecar-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org)

</div>

---

Hermes Desktop keeps the upstream Hermes agent foundation — providers, models,
skills, tools, memory, sessions, and config — and wraps it in a native desktop
workspace built with **Tauri**, **SolidJS**, **TypeScript**, and a **Python
sidecar**.

The goal is to make Hermes feel like a local workbench for software tasks:
project-aware conversations, model and profile controls, tool activity,
approvals, workspace status, and a native desktop shell around the agent
runtime.

<div align="center">

![Hermes Desktop home screen](desktop/public/hermes-desktop-home.png)

</div>

## ✨ What This Fork Adds

| | |
| :-- | :-- |
| 🖥️ **Native desktop app** | A Tauri v2 shell with custom window chrome, sidebar navigation, prompt composer, right-side environment panel, and desktop packaging targets. |
| 🐍 **Desktop-owned sidecar** | A Python daemon under `desktop/sidecar` exposes the local API surface used by the frontend and keeps desktop concerns out of the core agent loop. |
| 💬 **Workspace-first chat** | Conversations organized around local projects, git/workspace state, prompt planning controls, tool output, and approval flows. |
| 🔌 **Hermes core compatibility** | Continues to use the upstream agent concepts: providers, models, skills, tools, memory, sessions, and config. |
| 🧩 **Open development surface** | The desktop app lives in `desktop/` and can be run, tested, and packaged independently from the upstream CLI and gateway surfaces. |

## 🚀 Quick Start

> ⚠️ **Platform support:** Hermes Desktop currently runs on **macOS only**.
> Windows and Linux packaging is configured but not yet tested or supported.

**Prerequisites** (macOS)

- macOS 11 (Big Sur) or newer
- Node.js
- Rust and the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/) for macOS
- `uv` and Python 3.11 for the sidecar environment

**Run in development mode**

```bash
cd desktop
npm install
npm run tauri:dev
```

In development, Vite serves the frontend on `http://localhost:1420` and the
desktop sidecar uses port `18080`.

## 🛠️ Useful Commands

Run these from `desktop/`:

| Command | Description |
| :-- | :-- |
| `npm run dev` | Start the Vite frontend only |
| `npm run backend` | Start the Python sidecar daemon |
| `npm run tauri:dev` | Build the sidecar and run the Tauri desktop app |
| `npm run build` | Build the production frontend |
| `npm run tauri:build` | Build the packaged desktop application |
| `npm run type-check` | Run TypeScript type checking |
| `npm run lint` | Run ESLint for `desktop/src` |
| `npm run test` | Run Vitest unit tests |
| `npm run test:e2e` | Run Playwright end-to-end tests |

## 📁 Repository Layout

| Path | Purpose |
| :-- | :-- |
| `desktop/` | The desktop product: Tauri shell, SolidJS frontend, sidecar daemon, tests, and design docs |
| `desktop/src` | Desktop frontend features, stores, shell layout, services, and UI primitives |
| `desktop/sidecar` | Python daemon used by the desktop app |
| `desktop/src-tauri` | Rust/Tauri desktop integration and app packaging config |
| `run_agent.py`, `model_tools.py`, `toolsets.py` | Upstream Hermes agent runtime surfaces retained by this fork |
| `skills/`, `plugins/`, `tools/` | Hermes extension surfaces inherited from upstream |

For desktop-specific architecture notes, see
[desktop/README.md](desktop/README.md) and [desktop/DESIGN.md](desktop/DESIGN.md).

## 🔗 Relationship to Upstream Hermes Agent

This project is based on the open-source Hermes Agent codebase from
[Nous Research](https://github.com/NousResearch/hermes-agent). Upstream Hermes
provides the agent core, CLI, TUI, messaging gateway, tooling, skills, memory,
provider integrations, and scheduling foundations.

This fork focuses on the native desktop experience in `desktop/`. When working
on the desktop app, prefer extending that surface rather than changing upstream
core behavior — unless the desktop feature genuinely requires a shared runtime
change.

## 📝 Development Notes

- Keep desktop UI state and Hermes runtime configuration separate.
- Prefer small, feature-owned frontend stores over passing state through many
  layers.
- Use the existing sidecar and gateway adapter patterns before adding new
  communication paths.
- New model tools should stay out of core unless they are fundamental and
  broadly useful; most extension work belongs in commands, skills, plugins, or
  service-gated tools.

## 🙏 Acknowledgements

- **[Hermes Agent](https://github.com/NousResearch/hermes-agent)** — by [Nous Research](https://nousresearch.com). The agent runtime this fork is built upon.
- **[Codex](https://github.com/openai/codex)** — the macOS seatbelt sandbox mechanism in the desktop sidecar is adapted from the Codex project.

## 📄 License

MIT. See [LICENSE](LICENSE).
