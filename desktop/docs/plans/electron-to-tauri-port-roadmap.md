# Electron → Tauri Desktop 移植路线图

> 由 Electron(`apps/desktop/`) 与 Tauri(`desktop/`) 深度对比生成的参考蓝图。本文档用于挑选要移植的 features/bug 修复。
>
> **状态列已按 2026-07-03 代码核查回填**（✅ 已完成 / 🟡 部分 / ❌ 未做 / ⬜ N/A）。核查为「代码存在性 + 机制」判断，非逐项运行时 QA。

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
> 状态：✅ 已完成 / 🟡 部分（附「剩余」）/ ❌ 未做 / ⬜ N/A（机制不同或已确认不成立）。最后核查：2026-07-03。

---

## Tier 0 — 正确性 & 性能（P0，已确认缺陷/风险，优先做）

| # | 状态 | 项 | 影响 | 工作量 | 层 | Electron 源 → Tauri 目标 / 剩余 |
|---|---|---|---|---|---|---|
| 0.1 | ✅ 已完成 | **工具输出限长** | 高 | S | FE | `desktop/src/features/conversation/toolOutputClamp.ts`：`MAX_TOOL_RENDER_CHARS=20_000` + `clampForDisplay`，已接入 `ToolCard`/`ToolCallTree`/`cards/CardOutput`/`TurnActivityPanel`（含测试）。 |
| 0.2 | ✅ 已完成 | **transcript 虚拟化** | 高 | M | FE | `desktop/src/features/conversation/messageVirtualization.ts`（阈值 250）；`ChatView` 已用 spacer 窗口化消息列表。 |
| 0.3 | 🟡 部分 | **根错误边界从渲染竞态恢复** | 中 | S | FE | 现状：`shell/ModuleErrorBoundary.tsx` 提供手动「Try again」防白屏。**剩余**：崩溃后自动恢复（无需用户点按）。 |
| 0.4 | ⬜ N/A | **composer 附件空洞崩溃** | 中 | S | FE | 已确认不成立：SolidJS 下 `ReferenceCompletion.refText` 非可选，chip 访问用可选链 + `sanitizeAttachmentChips`，无 undefined ref 崩溃路径。 |
| 0.5 | ✅ 已完成 | **会话重连事件丢/重** | 高 | M | FE+SC | `services/gateway/http-adapter.ts` 按 session 的 `lastSeq` 去重 + `GET …/messages?since=` 重放；sidecar `routers/events.py` 重连重放待批准/输入（含测试）。 |
| 0.6 | ⬜ N/A | **resume 串号缓存** | 中 | S | FE | 已确认不成立：`stores/session.ts` 用 `resumeRequestEpoch` 取消陈旧请求，无 React 运行时缓存串号问题。 |
| 0.7 | ❌ 未做 | **启动 boot-burst 超时** | 中 | S | FE | Electron `4aad27b75`/`584d3ae53`：长超时覆盖全部启动调用。Tauri `transport-base.ts` 固定 ~30s，profile 多/慢机的启动调用（config/model/cron）会误超时。给启动阶段加长超时。 |
| 0.8 | ❌ 未做 | **prompt.submit 长回合误超时** | 中 | S | FE | Electron `164144183`：submit 为 fire-and-forget，超时提到 1.8e6ms。Tauri `prompt.execute` 用 ~30s，MoA/深推理 >30s 触发假超时。 |
| 0.9 | ❌ 未做 | **多行 slash 命令被吞** | 中 | S | FE | Electron `fb44b519d`：`[\s\S]*` + 空命令名恢复草稿。核对 Tauri `MessageInput.tsx` 的 slash 解析是否同样丢多行文本。 |
| 0.10 | ❌ 未做 | **reasoning_effort:false 回退 medium** | 中 | S | FE+SC | Electron `5a6720b88`：sidecar 布尔 `False` 解析 + FE 以 `""` 表示未设。Tauri sidecar `parse_reasoning_effort` 与 FE 空 select 需同步修。 |
| 0.11 | ❌ 未做 | **浮层压标题栏拖拽区** | 低 | S | FE | Electron `03311abe4`：浮层加 `-webkit-app-region:no-drag`。Tauri 顶部 `CommandPalette` 与 `TitleBar` dragSurface 冲突，需同样护栏。 |

---

## Tier 1 — 开发工作流对齐（P1）

| # | 状态 | 项 | 影响 | 工作量 | 层 | Electron 源 → Tauri 现状 / 剩余 |
|---|---|---|---|---|---|---|
| 1.1 | 🟡 部分 | **Codex 式 Review 面板细节对齐** | 中 | M | FE+SC | 现状：`features/diff/DiffPanel.tsx` 已有 file-tree（树/列表切换、折叠、缩进）、状态筛选、stage/unstage/revert、commit/push/PR 弹层、错误态。**剩余**：Electron 式 churn-bar 视觉条、独立 ship-bar 底栏布局。 |
| 1.2 | 🟡 部分 | **Projects 侧栏 + git worktree + coding rail** | 高 | L | FE+SC | 现状：**sidecar RPC 与 store 已就绪**（`sidecar/daemon/routers/projects.py`、`project_service.py`、`stores/projects.ts`：projects/worktrees/branches 增删切）。**剩余：只差前端** —— Projects 面板视图 + worktree 增删切 UI + 路由（当前仅侧栏 cwd 分组）。 |
| 1.3 | 🟡 部分 | **拖拽附件 + chat drop overlay** | 高 | M | FE+RS | 现状：`MessageInput.tsx`/`TerminalPanel.tsx` 已处理文件 drop（图片→`image.attach`，其他→`@file:`）。**剩余**：全窗口/聊天区 drop overlay；文件夹→`@folder:` 检测（Electron `a488fcf10` `webkitGetAsEntry`）。 |
| 1.4 | 🟡 部分 | **终端：选区→聊天(⌘L) + 纵向 resize + read_terminal + 拖入** | 中 | M | FE(+RS) | 现状：选区→聊天（按钮）、快照→聊天、文件拖入、`ResizeObserver` 自适应。**剩余**：⌘L 快捷键、显式纵向 resize 把手、sidecar `read_terminal` 工具。 |
| 1.5 | 🟡 部分 | **Open file 内嵌预览编辑 + preview console** | 低 | S-M | FE | 现状：`WorkspaceFilePreviewPane.tsx` 读/编辑/保存（mtime/size 守卫 + 错误态）齐全。**剩余**：preview console、非文件型 preview target。 |
| 1.6 | ✅ 已完成 | **队列条目 Edit / 立即发送** | 中 | S | FE | `QueuedPromptDock.tsx` 已含 Edit（铅笔）/ 立即发送（Send）/ Remove（垃圾桶）三操作。（原「仅 Remove + Steer-first」已过时。） |
| 1.7 | ✅ 已完成（简版） | **URL 插入** | 低 | S | FE | `MessageInput.tsx` 已用 `window.prompt('URL')` 生成 `@url:` chip。**剩余（可选）**：换成正式对话框而非原生 prompt。 |
| 1.8 | ❌ 未做 | **Profile 侧栏切换器** | 中 | M | FE+SC | Electron `6cffc37b5`（>13 profile 折叠为 select）+ 彩块 profile rail + 删除后 rail 刷新/防 respawn（`c3f06a8fd`/`c5e8a60b0`）。Tauri 仅设置内 `ProfileTab`，无侧栏切换 rail。 |

---

## Tier 2 — 窗口 / 会话 UX（P2）

| # | 状态 | 项 | 影响 | 工作量 | 层 | Electron 源 → Tauri 现状 / 剩余 |
|---|---|---|---|---|---|---|
| 2.1 | ❌ 未做 | **多窗口 / 二级会话窗口** | 中 | L | FE+RS | Electron `session-windows.cjs`+`store/windows.ts`+`session-sync.ts`。Tauri `src-tauri/src/lib.rs` 只建单 `main` 窗（`tauri.conf.json` 亦单窗）。需 Rust `WebviewWindow` 创建 + 跨窗会话同步。 |
| 2.2 | ❌ 未做 | **会话快速切换 HUD（^Tab）** | 中 | S | FE | Electron `store/session-switcher.ts`；Tauri `services/keyboard.ts` 无 Tab 循环/HUD。基本纯前端。 |
| 2.3 | ❌ 未做 | **composer 弹出独立窗口** | 低 | M | FE+RS | Electron `store/composer-popout.ts`；Tauri 无。依赖 2.1 的多窗口能力。 |
| 2.4 | 🟡 部分 | **WSL/Linux 标题栏 & GPU 渲染** | 中 | M | FE+RS | 现状：`shell/TitleBar.tsx` 已为 Linux 渲染自绘窗控件。**剩余**：Rust 侧 WSL2 GPU flags（`WEBKIT_DISABLE_COMPOSITING_MODE`/`LIBGL_ALWAYS_SOFTWARE` 等）。WCO 宽度逻辑 N/A。 |
| 2.5 | ❌ 未做 | **WSL2 剪贴板图片 PowerShell 桥** | 低 | M | +RS | Electron `wsl-clipboard-image.cjs`。Tauri `src-tauri/src/commands/clipboard.rs` 仅原生 clipboard API，WSL2 下静默返回 None，缺宿主 PowerShell 桥。 |
| 2.6 | ❌ 未做 | **Memory Graph `/journey` 星图 overlay** | 中 | L | FE(+SC) | Electron `931e2356a` 等：`/journey` 打开放射时间线画布（可播放 + 编辑/删除 + 分享/导入 + per-profile 缓存）。Tauri `features/memory/` 仅文本搜索，无 journey overlay。 |

---

## Tier 3 — 打磨 & 额外功能（P3）

| # | 状态 | 项 | 影响 | 工作量 | 层 | Electron 源 → Tauri 现状 / 剩余 |
|---|---|---|---|---|---|---|
| 3.1 | ❌ 未做 | **宠物/吉祥物系统**（最大单体，自包含） | 中 | XL | FE+RS+SC | Electron `app/pet-overlay/`、`components/pet/`、`app/pet-generate/`、`store/pet*.ts`。Tauri **完全没有**。需透明置顶 click-through 窗 + 全量 FE 移植 + sidecar 图像生成。 |
| 3.2 | ❌ 未做 | **主题市场 + VS Code 主题导入** | 中 | M | FE+RS/SC | Electron `src/themes/`+`vscode-marketplace.cjs`+`marketplace-theme-page.tsx`。Tauri `services/theme.ts` 仅 `light`/`dark`（`earth` 仅终端调色板，未做应用级可选）。需 `.vsix` 拉取/解包 + FE 导入 UI。 |
| 3.3 | ❌ 未做 | **Artifacts 画廊** | 中 | M | FE | Electron `app/artifacts/index.tsx`（跨会话抽取图片/文件/链接）。Tauri 无。纯前端。 |
| 3.4 | ❌ 未做 | **跨会话 Agents 总览** | 低 | M | FE+SC | Electron `app/agents/index.tsx`（跨会话）。Tauri `features/delegation/` 仅单会话。 |
| 3.5 | ❌ 未做 | **命令面板子页 + Command Center** | 低 | M | FE | Electron 多页 Cmd-K + `app/command-center/`。Tauri `CommandPalette.tsx` 扁平单列，无子页/导航栈。 |
| 3.6 | ❌ 未做 | **快捷键编辑器** | 低 | M | FE | Electron `keybind-panel.tsx`+`store/keybinds.ts`。Tauri `services/keyboard.ts` 硬编码，无持久化/重映射 UI。 |
| 3.7 | 🟡 部分 | **模型可见性对话框** | 低 | S | FE | 现状：`stores/models.ts` 有 `setProviderEnabled`/`setModelEnabled`，ModelSwitcher 内可开关。**剩余**：专用可见性对话框 / 按能力批量隐藏显示。 |
| 3.8 | ❌ 未做 | **MoA 预设作为可选虚拟模型** | 低 | M | FE+SC | Electron `c6575df92`；Tauri 仅 `moa` 图标。实现时须走**持久化 preset（`config.set`/`onSelectModel`）**而非一次性 `/moa` dispatch（Electron `9be292f1e`）。 |
| 3.9 | ❌ 未做 | **半透明 / 触感 / 完成音效** | 低 | S–M | FE(+RS) | Electron `store/translucency.ts`/`haptics.ts`/`completion-sound.ts`；Tauri 无（半透明需 Rust 窗口 vibrancy）。 |
| 3.10 | 🟡 部分 | **消息平台凭据管理器** | 低 | M | FE+SC | 现状：Gateway `SetupWizard` 有 per-platform 凭据表单（`platformRegistry.ts`）。**剩余**：独立凭据管理器（已存凭据展示 / 删除 / 轮换 / 汇总）。 |
| 3.11 | 🟡 部分 | **小 UI 打磨**：statusbar tooltip、紧凑工具行标题/shimmer、amber 修改点 | 低 | S | FE | 现状：标题栏 tooltip（原生 `title`）、模型卡骨架 pulse、紧凑工具行标题。**剩余**：工具行 shimmer、amber 修改点标记、`75rem` 内页宽度上限（Electron `66c3d595d`）。 |

---

## 已落地（本路线图之后 Tauri 新增，非移植项）

> 2026-06-30 之后 `desktop/` 已单独实现、原路线图未覆盖的能力。列此以免重复排期。

- **Jupyter Notebook 实时预览**：sidecar `NotebookService`/`NotebookWatchService`、SSE `notebook.changed`、`NotebookPreview`（KaTeX 数学渲染）、`.ipynb` 右键路由、`notebookPreviewStore`。
- **Plan card 预览动作**：`AssistantMessage.tsx`/`RightToolPanel.tsx` 计划卡内联预览/操作按钮。
- **Todo dock 改进 + 回合 rerun**：`conversation_turns` 增 `active`/`core_user_message_id` 列，rerun 端点接入 `commands.py`，todo dock 恢复 rerun 按钮。

---

## 不移植清单（Electron 专属 / 机制不同 / N/A）

- **composer contentEditable 清空修复**（`a3c4d2dc3`）— assistant-ui/React 特定；Tauri 已用 `clearComposerDraft(sid)` 清空。
- **WCO 标题栏宽度逻辑**（`titlebar-overlay-width.cjs`、`76074b218`）— Tauri 自绘 frameless 标题栏，大体 N/A（仅 2.4 的 Linux/WSL 渲染另算）。
- **git-pull 自更新套件**（`update-*.cjs`）— Tauri 用签名 bundle `tauri-plugin-updater`，机制不同且已具备。
- **backend 解析阶梯 / `install.ps1` bootstrap**（`backend-*.cjs`、`bootstrap-*.cjs`）— Tauri 启 PyInstaller sidecar binary，机制不同。
- **session-partition OAuth**（`oauth-net-request.cjs`）— Tauri 经 sidecar `routers/oauth.py`，已工作。
- **Windows 注册表 env 读取、link-title 离屏窗、原生卸载器、桌面密钥加密** — 小众/机制不同，默认不移植（除非有明确诉求）。
- **remote 模式修复**（artifact 渲染 `03406ae25`、file-picker 附件 `c19bfb50a`、附件预览 local-first `fe82b3a77`、model options 预取 `a9b559890`）— Tauri 为单 sidecar 架构，无 `isRemote` 多网关路径，N/A。
- **macOS Tahoe 交通灯错位修复**（`e40175f06`）— Tauri 自绘 frameless 标题栏，原生 `titleBarOverlay` 高度是 Electron 概念，N/A。
- **xAI Grok OAuth device-code-only**（`5ef0b8acb`）— 归属 session-partition OAuth 一类，Tauri 走 sidecar `routers/oauth.py`。

---

## 建议落地顺序（2026-07-03 修订）

> Tier 0 原始四项已完成/确认 N/A（0.1/0.2/0.5 done，0.4/0.6 N/A，仅 0.3 自动恢复留尾）。以下为剩余优先级。

1. **新 Tier 0 正确性小项（0.7–0.11）**——均为 S 工作量、正确性收益高：启动/长回合超时、多行 slash、`reasoning_effort:false`、浮层拖拽区。先做。
2. **收尾 Tier 1**：优先 **1.2 前端 Projects/worktree 面板**（后端已就绪，性价比最高）→ 1.1 churn/ship-bar → 1.3 全窗 drop overlay → 1.4 终端 ⌘L/纵向 resize/read_terminal。
3. **Tier 2.1 多窗口** 是 2.2/2.3 的前置；2.6 `/journey`、1.8 Profile rail 视诉求排入。
4. **Tier 3** 按品牌/体验诉求挑选；3.1 宠物系统单独立项（XL）。

---

## Verification（验证方式）

**通用**：在 `desktop/` 下 `npm run dev`（Vite + Tauri）或 `npm run tauri dev`；sidecar 由 Rust 层自动起（dev 走 `uv run python -m daemon`）。前端单测 `npm run test`（vitest），E2E `playwright.config.ts`。sidecar 测试在 `desktop/sidecar/`（`uv run pytest`）。

**分项验证**：
- **0.1/0.2 性能（已完成，回归用）**：构造超大输出工具调用（`/learn`、大文件+大 diff），确认 UI 不冻结、超限有截断提示、长会话滚动流畅。回归对照 `toolOutputClamp.test.tsx` / `messageVirtualization`。
- **0.3 自动恢复（留尾）**：复现渲染竞态崩溃，确认是否需用户点「Try again」——目标是自动恢复。
- **0.7–0.11 新正确性项**：分别验证慢启动不误超时、MoA/深推理长回合不假超时、多行 `/goal` 不丢、`reasoning_effort:false` 不回退 medium、顶部浮层不吞标题栏拖拽。
- **1.1 Review**：脏工作区 stage/commit/push + `gh` 建 PR 全流程；确认 Files Tree 层级/筛选/折叠/单文件操作与错误态；sidecar 端点 `pytest` 覆盖 `git_service.py`。
- **1.2 Projects/worktree**：后端已就绪，重点验证新前端面板的列表/worktree 增删切与 `projectStore` 往返。
- **1.3 拖拽**：拖入文件/图片/文件夹到聊天区，确认全窗 drop overlay + 附件 chip 正确生成。
- **2.1 多窗口**：开二级会话窗，跨窗会话状态同步、关闭/聚焦协调正确。
- **3.1 宠物**：透明置顶窗 click-through、Alt+滚轮缩放、AI 生成 sprite 落盘并加载。

每个 Tier 完成后跑 `npm run lint` + `npm run test`（前端）与 sidecar `pytest`，并用 code-review-graph MCP `detect_changes` 做改动风险体检。
