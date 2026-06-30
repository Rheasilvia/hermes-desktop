# Electron → Tauri Desktop 移植路线图

> 由 Electron(`apps/desktop/`) 与 Tauri(`desktop/`) 深度对比生成的参考蓝图。本文档用于挑选要移植的 features/bug 修复，**不代表已实现**。

## Context（背景）

本仓库 `hermes-desktop` 同时存在两个并行的桌面客户端：

| | 路径 | 技术栈 | 状态 |
|---|---|---|---|
| **Electron** | `apps/desktop/` | React + assistant-ui，重 main-process（`electron/*.cjs`，~40 个原生模块） | 成熟上游（600 commits） |
| **Tauri** | `desktop/` | SolidJS + 极薄 Rust 层 + Python sidecar（FastAPI，HTTP/SSE） | 活跃 fork（305 commits），仍在追平 |

目标：把 Electron 已有、而 Tauri 缺失/较弱的 **features 与 bug 修复** 系统性地识别出来，按影响/工作量分级，形成可执行的移植蓝图。**本文档为参考路线图，暂不写代码**——后续按需挑选条目实施。

### 关键架构差异（移植前必读）

1. **大部分产品能力在 sidecar，不在 Rust。** Tauri 的原生面（Rust commands）刻意很薄：仅 file IO（限定 `HERMES_HOME`）、clipboard image、PTY terminal、updater、sidecar 启停、workspace 选择。sessions/git/model/mcp/cron/memory/skills/plugins/profiles/delegation/audio/approvals 全在 Python sidecar（`desktop/sidecar/daemon/`）走 HTTP/SSE。**因此「移植」大多 = SolidJS 前端重写 + sidecar 端点扩展，而非新增 Rust command。**
2. **框架不同，部分 Electron 修复不能 1:1 搬。** Electron 是 React/assistant-ui，Tauri 是 SolidJS。涉及 `contentEditable`、React runtime、assistant-ui 内部状态的修复（见 §不移植清单）必须先在 Tauri 实测复现，再决定是否需要等价修复，**不可盲搬**。
3. **更新/启动/OAuth 机制本就不同。** Tauri 用 `tauri-plugin-updater`（签名 bundle）、PyInstaller sidecar binary、sidecar OAuth router——与 Electron 的 git-pull 自更新、`install.ps1` bootstrap、session-partition OAuth 是两套模型，**不应移植机制本身**。

> 图例：影响 = 高/中/低；工作量 S(<0.5d) / M(0.5–2d) / L(3–5d) / XL(1–2wk)；层 FE(SolidJS 前端) / +SC(需 sidecar) / +RS(需 Rust)。

---

## Tier 0 — 正确性 & 性能（P0，已确认缺陷/风险，优先做）

| # | 项 | 影响 | 工作量 | 层 | Electron 源 → Tauri 目标 |
|---|---|---|---|---|---|
| 0.1 | **工具输出未限长（已确认）** | 高 | S | FE | Electron `MAX_TOOL_RENDER_CHARS = 20_000` + `clampForDisplay`（`apps/desktop/src/components/assistant-ui/tool-fallback-model.ts`，含测试）→ Tauri `ToolCard.tsx`/`ToolCallTree.tsx`/`cards/CardOutput*` **无任何 clamp**。大输出（`/learn`、大 diff）会全量渲染卡死。加截断 + "显示完整/省略 N 字符"。 |
| 0.2 | **transcript 未虚拟化** | 高 | M | FE | Tauri 仅 diff 面板虚拟化（`desktop/src/features/diff/virtual-diff.ts`），聊天消息列表未做窗口化；Electron 侧列表 `VIRTUALIZE_THRESHOLD=25`。长会话给 `cards/CardList.tsx`/消息列表加 windowing。与 0.1 一起做。 |
| 0.3 | **根错误边界从渲染竞态恢复** | 中 | S | FE | Electron `2e3efce66`。Tauri 有 `desktop/src/shell/ModuleErrorBoundary.tsx`，但恢复策略不同——核对崩溃后是否能自恢复而非白屏。 |
| 0.4 | **composer 附件空洞崩溃** | 中 | S | FE | Electron `7e2db0a14`（refText on undefined attachment holes）。在 `desktop/src/features/conversation/MessageInput.tsx` 复核 undefined 附件 ref 的处理。**先复现再修。** |
| 0.5 | **会话重连事件丢/重** | 高 | M | FE+SC | TODO-TUI-PARITY P0：重连时按 session id 路由，避免事件 drop/duplicate。`desktop/src/features/conversation/eventSubscription.ts` + sidecar `routers/events.py`。 |
| 0.6 | **resume 串号缓存** | 中 | S | FE | Electron `f7bf74064`（cross-wired runtime-id cache）。React 特定，**先验证 Tauri resume 是否串号**，是则修。 |

---

## Tier 1 — 开发工作流对齐（P1）

| # | 项 | 影响 | 工作量 | 层 | Electron 源 → Tauri 现状 |
|---|---|---|---|---|---|
| 1.1 | **Codex 式 Review 面板细节对齐** | 中 | M | FE+SC | Electron `apps/desktop/src/app/right-sidebar/review/`（file-tree + churn-bar + ship-bar）。Tauri 已有 `features/diff/DiffPanel.tsx` + `git_service.py` 的 Review 工作流（stage/unstage/revert/commit/push/PR 等），后续重点是 file-tree 层级/密度、churn/ship 细节与错误态体验继续对齐。 |
| 1.2 | **Projects 侧栏 + git worktree + coding rail** | 高 | L | FE+SC | Electron `electron/git-worktree-ops.cjs`+`git-repo-scan.cjs`+ 后端权威 projects 侧栏 + worktree 流（`7a7f9a5b3`,`488ae376d`）。Tauri 侧栏仅按 cwd 客户端分组，无 projects RPC/worktree。需 sidecar worktree/projects 端点 + FE。 |
| 1.3 | **拖拽附件 + chat drop overlay** | 高 | M | FE+RS | Electron `composer/drop-affordance.ts`、`hooks/use-file-drop-zone.ts`、`chat-drop-overlay.tsx`。Tauri 仅原生 dialog + 剪贴板粘贴。用 Tauri `getCurrentWebview().onDragDropEvent`。 |
| 1.4 | **终端：选区→聊天(⌘L) + 纵向 resize + read_terminal + 拖入** | 中 | M | FE(+RS) | Electron `apps/desktop/src/app/right-sidebar/terminal/`。Tauri `TerminalPanel.tsx` 多 tab，但仅横向 resize，无选区取词入聊天。 |
| 1.5 | **Open file 内嵌预览编辑 + preview console** | 低 | S-M | FE | Electron `right-rail/preview-file.tsx`(可编辑)+`preview-console.tsx`+`store/preview-edit.ts`。Tauri 已将文件预览/编辑整合进 Open file（`WorkspaceFilePreviewPane.tsx` + workspace `readFile`/`writeFile`）；仍缺的是 preview console 或非文件型 preview target。 |
| 1.6 | **队列条目 Edit / 立即发送** | 中 | S | FE | Electron `composer/queue-panel.tsx`。Tauri `QueuedPromptDock.tsx` 仅 Remove + Steer-first。 |
| 1.7 | **URL 插入对话框** | 低 | S | FE | Electron `composer/url-dialog.tsx`；Tauri 无。 |

---

## Tier 2 — 窗口 / 会话 UX（P2）

| # | 项 | 影响 | 工作量 | 层 | Electron 源 → Tauri 现状 |
|---|---|---|---|---|---|
| 2.1 | **多窗口 / 二级会话窗口** | 中 | L | FE+RS | Electron `electron/session-windows.cjs`+`store/windows.ts`+`store/session-sync.ts`。Tauri 只建单 main 窗口（`src-tauri/src/lib.rs`）。需 Rust `WebviewWindow` 创建 + 跨窗会话同步——Tauri 侧较大改造。 |
| 2.2 | **会话快速切换 HUD（^Tab）** | 中 | S | FE | Electron `store/session-switcher.ts`；Tauri 无。基本纯前端。 |
| 2.3 | **composer 弹出独立窗口** | 低 | M | FE+RS | Electron `store/composer-popout.ts`；Tauri 无。依赖 2.1 的多窗口能力。 |
| 2.4 | **WSL/Linux 标题栏 & GPU 渲染** | 中 | M | FE+RS | Electron `3b1344c18`(WSL 标题栏+GPU 加速)、`da5484b61`(Linux titlebar overlay)。Tauri 自绘 frameless 标题栏，**WCO 宽度逻辑 N/A**，但 Linux/WSL 下渲染与 GPU flags 值得单独验证。 |
| 2.5 | **WSL2 剪贴板图片 PowerShell 桥** | 低 | M | +RS | Electron `wsl-clipboard-image.cjs`。Tauri 有原生 clipboard image（`clipboard.rs`），但缺 WSL2 宿主桥（仅 WSL 场景）。 |

---

## Tier 3 — 打磨 & 额外功能（P3）

| # | 项 | 影响 | 工作量 | 层 | Electron 源 → Tauri 现状 |
|---|---|---|---|---|---|
| 3.1 | **宠物/吉祥物系统**（最大单体，自包含） | 中 | XL | FE+RS+SC | Electron `app/pet-overlay/`、`components/pet/`、`app/pet-generate/`、`store/pet*.ts`（透明置顶 click-through 窗 + Alt+滚轮缩放 + AI 生成 + gallery + 设置 + palette 页）。Tauri **完全没有**。需 Tauri 透明 always-on-top overlay 窗 + 全量 FE 移植 + sidecar 图像生成。 |
| 3.2 | **主题市场 + VS Code 主题导入** | 中 | M | FE+RS/SC | Electron `src/themes/`+`electron/vscode-marketplace.cjs`+`marketplace-theme-page.tsx`。Tauri 仅 light/dark/earth。需 `.vsix` 拉取/解包（Rust 或 sidecar）+ FE 导入 UI。 |
| 3.3 | **Artifacts 画廊** | 中 | M | FE | Electron `app/artifacts/index.tsx`（跨会话抽取图片/文件/链接）。Tauri 无。纯前端。 |
| 3.4 | **跨会话 Agents 总览** | 低 | M | FE+SC | Electron `app/agents/index.tsx`（跨会话）。Tauri `features/delegation/` 仅单会话。 |
| 3.5 | **命令面板子页 + Command Center** | 低 | M | FE | Electron 多页 Cmd-K + `app/command-center/`。Tauri `CommandPalette.tsx` 扁平。 |
| 3.6 | **快捷键编辑器** | 低 | M | FE | Electron `app/shell/keybind-panel.tsx`+`store/keybinds.ts`。Tauri `services/keyboard.ts` 固定。 |
| 3.7 | **模型可见性对话框** | 低 | S | FE | Electron `model-settings.tsx`+`store/model-visibility.ts`；Tauri 无（overlay PATCH 已存在可复用）。 |
| 3.8 | **MoA 预设作为可选虚拟模型** | 低 | M | FE+SC | Electron `c6575df92`；Tauri 仅 `moa` 图标。 |
| 3.9 | **半透明 / 触感 / 完成音效** | 低 | S–M | FE(+RS) | Electron `store/translucency.ts`/`haptics.ts`/`completion-sound.ts`；Tauri 无（半透明需 Rust 窗口 vibrancy）。 |
| 3.10 | **消息平台凭据管理器** | 低 | M | FE+SC | Electron `app/messaging/index.tsx`；Tauri 仅 gateway 设置。 |
| 3.11 | **小 UI 打磨**：statusbar tooltip、紧凑工具行标题/shimmer、amber 修改点 | 低 | S | FE | Electron `da73223f4`/`41f302fa7`/`09623b452`。 |

---

## 不移植清单（Electron 专属 / 机制不同 / N/A）

- **composer contentEditable 清空修复**（`a3c4d2dc3`）— assistant-ui/React 特定；Tauri 已用 `clearComposerDraft(sid)` 清空。
- **WCO 标题栏宽度逻辑**（`titlebar-overlay-width.cjs`、`76074b218`）— Tauri 自绘 frameless 标题栏，大体 N/A（仅 2.4 的 Linux/WSL 渲染另算）。
- **git-pull 自更新套件**（`update-*.cjs`）— Tauri 用签名 bundle `tauri-plugin-updater`，机制不同且已具备。
- **backend 解析阶梯 / `install.ps1` bootstrap**（`backend-*.cjs`、`bootstrap-*.cjs`）— Tauri 启 PyInstaller sidecar binary，机制不同。
- **session-partition OAuth**（`oauth-net-request.cjs`）— Tauri 经 sidecar `routers/oauth.py`，已工作。
- **Windows 注册表 env 读取、link-title 离屏窗、原生卸载器、桌面密钥加密** — 小众/机制不同，默认不移植（除非有明确诉求）。

---

## 建议落地顺序

1. **先 Tier 0**（尤其 0.1 工具输出限长 + 0.2 虚拟化）——已确认的卡死/正确性风险，工作量小、收益高。
2. **再 Tier 1.1 / 1.2 / 1.3**——开发者日常最痛的 Review/worktree/拖拽，决定 Tauri 能否作为主力开发客户端。
3. **Tier 2.1 多窗口** 是后续 2.2/2.3 的前置，按需启动。
4. **Tier 3** 按品牌/体验诉求挑选；3.1 宠物系统单独立项（XL）。

---

## Verification（验证方式）

**通用**：在 `desktop/` 下 `npm run dev`（Vite + Tauri）或 `npm run tauri dev`；sidecar 由 Rust 层自动起（dev 走 `uv run python -m daemon`）。前端单测 `npm run test`（vitest），E2E `playwright.config.ts`。sidecar 测试在 `desktop/sidecar/`（`uv run pytest`）。

**分项验证**：
- **0.1/0.2 性能**：构造一次产生超大输出的工具调用（如 `/learn` 或读大文件 + 大 diff），确认 UI 不冻结、超限有截断提示、长会话滚动流畅。对照 Electron `tool-fallback-model.test.ts` 写等价 vitest。
- **0.3/0.4/0.6 防御性**：先在 Tauri 复现崩溃路径（渲染竞态、空附件、resume 串号）作为失败用例，再修复转绿。
- **1.1 Review**：在脏工作区里 stage/commit/push、`gh` 建 PR 全流程；确认 Files Tree 层级、筛选、折叠、单文件操作与错误态；sidecar 端点用 `pytest` 覆盖 `git_service.py` 新增方法。
- **1.3 拖拽**：拖入文件/图片/文件夹到聊天区，确认 drop overlay + 附件 chip 正确生成。
- **2.1 多窗口**：开二级会话窗，跨窗会话状态同步、关闭/聚焦协调正确。
- **3.1 宠物**：透明置顶窗 click-through、Alt+滚轮缩放、AI 生成 sprite 落盘并加载。

每个 Tier 完成后跑 `npm run lint` + `npm run test`（前端）与 sidecar `pytest`，并用 code-review-graph MCP `detect_changes` 做改动风险体检。
