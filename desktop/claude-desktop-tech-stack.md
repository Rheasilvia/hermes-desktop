# Claude Desktop 技术栈调研报告

## 调研方法

通过逆向分析 macOS 上的 Claude Desktop App (`/Applications/Claude.app`)，提取 `app.asar` 包内容，解析 `package.json` 和构建产物，获取精确的技术栈信息。

**逆向步骤：**
1. 使用 `asar` 工具提取 `app.asar`
2. 分析 `package.json` 依赖声明
3. 检查 Vite 构建输出结构
4. 解析 vendor bundle 中的运行时版本标记

---

## 1. 桌面壳层 (Electron)

| 技术 | 版本 | 说明 |
|------|------|------|
| **Electron** | `41.3.0` | 跨平台桌面应用框架 |
| **Electron Forge** | `7.8.3` | 构建与打包工具链 |
| **@electron-forge/plugin-vite** | `7.8.3` | Vite 集成插件 |
| **@electron-forge/maker-dmg** | `7.8.3` | macOS DMG 打包 |
| **@electron-forge/maker-squirrel** | `7.8.3` | Windows 安装包 |
| **@electron-forge/maker-zip** | `7.8.3` | 通用 ZIP 打包 |
| **@electron/notarize** | `^2.5.0` | 应用公证 |
| **@electron/fuses** | `^1.8.0` | Electron 功能开关 |
| **electron-store** | `^8.2.0` | 本地配置持久化 |
| **electron-window-state** | `^5.0.3` | 窗口状态管理 |
| **electron-devtools-installer** | `^4.0.0` | 开发工具安装 |

### 窗口结构

Claude Desktop 使用多窗口架构，Vite 构建输出包含以下 renderer 入口：

- `main_window` - 主聊天窗口
- `about_window` - 关于页面
- `buddy_window` - 辅助窗口
- `find_in_page` - 页面内查找
- `quick_window` - 快捷窗口

---

## 2. 前端框架与运行时

| 技术 | 版本 | 说明 |
|------|------|------|
| **React** | `19.2.4` | UI 框架（从 vendor bundle 运行时确认） |
| **React DOM** | `19.2.4` | React DOM 渲染器 |
| **TypeScript** | `~6.0.2` | 类型系统 |
| **Vite** | `6.4.1` | 构建工具 |
| **@vitejs/plugin-react** | `^4.2.0` | React 官方 Vite 插件 |
| **Bun** | - | 团队公开说明使用 Bun 作为运行时 |

> **注意：** 此前外部报道的 React 18 不准确，实际逆向分析确认使用 **React 19.2.4**。

---

## 3. 路由与导航

| 技术 | 说明 |
|------|------|
| **TanStack Router** | 路由框架（从 `__TSR_index`、`__TSR_key` 等运行时标记确认） |

**证据：**
- `index.html` 中的 `data-build-id="spa-dev"` 标记
- vendor bundle 中的 `TSR`（TanStack Router）相关代码：`__TSR_key`、`__TSR_index`、`popstate` 导航管理器
- 路由状态通过 `window.history` 的 `pushState`/`replaceState` 封装管理

---

## 4. 状态管理

**自定义状态管理实现**，非 Redux / Zustand / Jotai 等常见库。

**特征：**
- vendor bundle 中发现类似 Signals 的原语实现（`an`、`nn` 类）
- 使用 `WeakMap` / `Set` 管理依赖图和订阅关系
- 支持计算属性（computed）和深度依赖追踪
- 采用推送-拉取混合的响应式更新机制

---

## 5. 样式系统

| 技术 | 版本 | 说明 |
|------|------|------|
| **TailwindCSS** | `3.4.14` | 原子化 CSS 框架 |
| **@tailwindcss/forms** | `^0.5.3` | 表单元素样式插件 |
| **@tailwindcss/typography** | `^0.5.13` | 排版样式插件 |
| **@phosphor-icons/react** | `2.1.4` | 图标库 |
| **clsx** | `^2.1.1` | 条件类名工具 |

**主题系统：**
- 支持 `data-theme="claude"` 属性切换
- 支持 `data-mode="auto"` 深色/浅色模式自动切换
- 使用 `data-color-version="v2"` 标记颜色系统版本

---

## 6. 国际化 (i18n)

| 技术 | 版本 | 说明 |
|------|------|------|
| **react-intl** | `^6.7.2` | React 国际化 |
| **@formatjs/intl** | `2.10.7` | FormatJS 核心 |

**支持语言：**
- 英语 (en, en-US, en-GB)
- 中文 (zh_CN, zh_TW)
- 日语 (ja-JP)
- 韩语 (ko-KR)
- 德语 (de, de-DE)
- 法语 (fr, fr-FR)
- 西班牙语 (es, es-ES, es-419)
- 意大利语 (it-IT)
- 葡萄牙语 (pt-BR)
- 俄语 (ru)、阿拉伯语 (ar)、印地语 (hi-IN) 等 30+ 语言

---

## 7. 核心功能依赖

### Anthropic 内部 SDK

| 包名 | 版本 | 说明 |
|------|------|------|
| `@anthropic-ai/sdk` | `^0.70.0` | 官方 API SDK |
| `@anthropic-ai/claude-agent-sdk` | `0.2.119` | Agent SDK |
| `@anthropic-ai/conway-client` | `0.2.0-dev` | 内部客户端 |
| `@anthropic-ai/mcpb` | `2.1.2` | MCP 协议缓冲区 |
| `@anthropic-ai/operon-core` | workspace | 内部核心框架 |
| `@anthropic-ai/operon-web` | workspace | 内部 Web 框架 |

### Anthropic 内部服务包

| 包名 | 说明 |
|------|------|
| `@ant/claude-native` | 原生功能桥接 |
| `@ant/claude-swift` | Swift 集成（macOS） |
| `@ant/computer-use-mcp` | Computer Use MCP 服务 |
| `@ant/claude-for-chrome-mcp` | Chrome 扩展 MCP |
| `@ant/imagine-server` | 图像生成服务 |
| `@ant/chrome-native-host` | Chrome 原生消息宿主 |
| `@ant/claude-ssh` | SSH 功能 |
| `@ant/cowork-win32-service` | Windows 协作服务 |
| `@ant/disclaimer` | 免责声明系统 |
| `@ant/dxt-registry` | 注册表服务 |
| `@ant/ipc-codegen` | IPC 代码生成 |
| `@ant/utils` | 工具库 |

### 外部核心库

| 包名 | 版本 | 说明 |
|------|------|------|
| `@modelcontextprotocol/sdk` | `1.28.0` | MCP 协议 SDK |
| `@sentry/electron` | `^7.4.0` | 错误监控 |
| `@sentry/vite-plugin` | `^4.3.0` | Sentry Vite 插件 |
| `node-pty` | `1.1.0-beta34` | 伪终端（终端功能） |
| `ws` | `^8.18.0` | WebSocket 通信 |
| `zod` | `^3.25.64` | Schema 验证 |
| `zod-to-json-schema` | `^3.25.1` | Zod 转 JSON Schema |
| `rxjs` | `^7.8.1` | 响应式编程 |
| `sharp` | `0.34.3` | 图像处理 |
| `tree-sitter` | - | 语法解析（用于代码高亮/分析） |
| `ssh2` | `^1.16.0` | SSH2 协议实现 |
| `winston` | `^3.17.0` | 日志库 |

---

## 8. 开发工具链

| 工具 | 版本 | 说明 |
|------|------|------|
| **oxlint** | `1.57.0` | JavaScript/TypeScript Linter（OxC 项目） |
| **oxfmt** | `^0.27.0` | 代码格式化 |
| **knip** | `^5.61.3` | 未使用代码/依赖检测 |
| **vitest** | `^3.2.4` | 测试框架 |
| **tsx** | `^4.20.6` | TypeScript 执行器 |
| **magic-string** | `^0.30.21` | 字符串操作工具 |

---

## 9. 架构分析

### 应用版本
- **当前版本：** `1.4758.0`
- **包名：** `@ant/desktop`
- **作者：** Anthropic PBC
- **描述：** Desktop application for Claude.ai
- **Node 要求：** `>=22.0.0`

### 多进程架构

```
Claude.app (Electron Main)
├── Main Process (.vite/build/index.js)
│   ├── mainView.js        - 主视图控制器
│   ├── mainWindow.js      - 主窗口管理
│   ├── buddy.js           - 辅助进程
│   ├── aboutWindow.js     - 关于窗口
│   ├── findInPage.js      - 查找功能
│   ├── quickWindow.js     - 快捷窗口
│   └── mcp-runtime/       - MCP 运行时
├── Renderer Processes
│   ├── main_window/       - 主聊天界面
│   ├── about_window/      - 关于页面
│   ├── buddy_window/      - 辅助界面
│   ├── find_in_page/      - 查找界面
│   └── quick_window/      - 快捷界面
└── Web Workers
    ├── shell-path-worker  - Shell 路径解析
    ├── sqlite-worker      - SQLite 查询
    └── transcript-search-worker - 转录搜索
```

### Web 前端架构 (ion-dist/)

```
ion-dist/
├── index.html              - SPA 入口
├── assets/
│   ├── index-*.js          - 主应用 bundle
│   ├── vendor-*.js         - React + 依赖 vendor
│   ├── tree-sitter-*.js    - 语法解析器
│   └── *.css               - Tailwind 构建产物
├── audio/                  - 语音相关 Worker
├── i18n/                   - 国际化资源
│   ├── *.json              - 翻译文件
│   └── statsig/            - Statsig 实验配置
└── images/                 - 静态图片资源
```

---

## 10. 关键发现

1. **React 19 而非 React 18**：vendor bundle 中明确发现 `19.2.4` 版本标记
2. **TanStack Router 而非 React Router**：从运行时标记 `__TSR_*` 确认
3. **自定义状态管理**：非 Redux/Zustand，采用类似 Signals 的自定义实现
4. **OxC 工具链**：使用 Oxlint 和 Oxfmt 替代 ESLint/Prettier
5. **内部框架 Operon**：存在 `@anthropic-ai/operon-core` 和 `operon-web` 内部框架
6. **MCP 原生支持**：内置 `@modelcontextprotocol/sdk` 和多个 MCP 服务包
7. **多窗口架构**：使用 Electron 多窗口，每个窗口独立 Vite 构建入口

---

## 参考来源

- Claude Desktop App 逆向分析（`/Applications/Claude.app`）
- `app.asar` 解包分析（`package.json`、`/tmp/claude-asar/`）
- `ion-dist/index.html` 和 `vendor-Ch-5ZYjK.js` bundle 解析

---

*报告生成时间：2026-04-28*
