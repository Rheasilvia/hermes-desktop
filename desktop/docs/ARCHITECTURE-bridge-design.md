# Hermes Desktop Bridge Architecture Design

> **修订状态**：v3（2026-04-24 更新）
> **设计决策**：Q1=A 删除 LocalLLMBridge / Q2=A 内嵌 Python sidecar / Q3=A 新增 `client.tool.*` 协议 / Q4=C Capability Grant 模型 / Q5=A TUI 无 Bridge / Q6=A 直接覆盖原文 / **Q7=UDS Transport 插件化**（替代 WebSocket）

---

## 0. 设计哲学

```
TUI (Terminal) ────────┐
                       │──▶ Python Gateway ──▶ LLM / Tools / MCP / Memory
Desktop (GUI) ─────────┘       ▲
                               │ client.tool.* (Native Tool Provider)
                        ┌──────┴──────┐
                        │   Bridge    │  ◀── Desktop native capabilities
                        └─────────────┘
```

**核心原则**：

1. **TUI 与 Desktop 平行同级** —— 都是 Python Gateway 的客户端。
2. **Gateway 是 AI 通道** —— 负责 Agent 业务逻辑（LLM、Tool、MCP、Memory）。**所有 LLM 调用都走 Gateway**，包括本地模型（Ollama）。
3. **Bridge 是 Native 通道** —— 负责 Desktop 特有的系统级能力（文件、OS、窗口、媒体、本地资源管理）。
4. **Gateway 通过 `client.tool.*` 协议反向调用 Bridge** —— Desktop 在握手时把 Bridge 能力注册为 client-side tools，Gateway 把它们当作普通 tool 暴露给 LLM。
5. **客户端能力变更只发生在 session 边界** —— 中途切换会破坏 prompt cache，禁止 mid-session 重新协商。
6. **Desktop 内嵌 Python sidecar** —— 安装包自带 Python runtime + Gateway，开箱即用，无需用户预装。

---

## 1. 系统总体架构

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Hermes Ecosystem                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│   ┌──────────────────────────────┐    ┌──────────────────────────────┐       │
│   │         TUI Client            │    │        Desktop Client         │       │
│   │      (Python + Rich)          │    │     (Tauri v2 + SolidJS)      │       │
│   │                               │    │                               │       │
│   │  UI Components                │    │  UI Components                │       │
│   │  Gateway Client               │    │  Gateway Layer                │       │
│   │  (无 Bridge —— 见 §11)        │    │  Bridge Layer                 │       │
│   │                               │    │  PermissionBroker             │       │
│   └──────────────┬────────────────┘    └──────────────┬────────────────┘       │
│                  │ JSON-RPC 2.0 (stdio)               │ JSON-RPC 2.0 (stdio/UDS)│
│                  │   ── 协议详见 §2.5 ──              │ + client.tool.* 反向    │
│                  └────────────────┬───────────────────┘                        │
│                                   ▼                                            │
│   ┌────────────────────────────────────────────────────────────────────────┐  │
│   │                    Python Gateway (tui_gateway)                          │  │
│   │                                                                          │  │
│   │  Session Mgr │ Prompt Router │ Tool Exec │ MCP Client                   │  │
│   │  Memory      │ Skill Registry│ Config    │ Cron Scheduler               │  │
│   │  Capability Registry (per-client tool registration)  ◀── 新增           │  │
│   │                                                                          │  │
│   │  LLM Router (litellm/unified)                                           │  │
│   └─────────────────────────────────┬──────────────────────────────────────┘  │
│                                     │                                          │
│                ┌────────────────────┼────────────────────┐                    │
│            ┌───┴───┐           ┌────┴────┐          ┌────┴────┐              │
│            │OpenAI │           │Anthropic│          │ Ollama  │              │
│            └───────┘           └─────────┘          └─────────┘              │
│                                                       (本地模型也走 Gateway) │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Desktop 内部架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Desktop Application                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    SolidJS Frontend                        │  │
│  │                                                            │  │
│  │  Stores ──▶ Views ──▶ Components                           │  │
│  │     │                                                      │  │
│  │     ├──▶ Gateway Layer (AI Agent capabilities)             │  │
│  │     │       • session, prompt, tools, model                │  │
│  │     │       • mcp, memory, skills, cron                    │  │
│  │     │       • client.tool.* 反向调用入口                   │  │
│  │     │                                                      │  │
│  │     ├──▶ Bridge Layer (Native capabilities)                │  │
│  │     │       • filesystem, os, window, updater              │  │
│  │     │       • process, media                               │  │
│  │     │       • gateway-lifecycle (sidecar 管理)             │  │
│  │     │                                                      │  │
│  │     └──▶ PermissionBroker (capability grant + 审计)        │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│              ┌───────────────┼───────────────┐                   │
│              ▼               ▼               ▼                   │
│  ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐     │
│  │  Gateway Layer   │ │ Bridge Layer │ │ Sidecar Manager  │     │
│  │  (TypeScript)    │ │ (TypeScript) │ │ (TypeScript)     │     │
│  │                  │ │              │ │                  │     │
│  │  GatewayClient   │ │ BridgeFactory│ │ Spawn embedded   │     │
│  │  Transport       │ │ (per-cap impl│ │ Python + tui_    │     │
│  │  ToolHandler ◀──┼─┤  + Mock)     │ │ gateway          │     │
│  └────────┬─────────┘ └──────┬───────┘ └────────┬─────────┘     │
│           │                  │                  │                │
│           │ JSON-RPC         │ Tauri Cmd        │ child process  │
│           │ over UDS/Named   │                  │ + socket path  │
│           │ Pipe             │                  │ discovery      │
│           ▼                  ▼                  ▼                │
│  ┌──────────────────┐ ┌──────────────┐ ┌──────────────────┐     │
│  │ Python Gateway   │ │ Tauri Rust   │ │ Embedded Python  │     │
│  │ (sidecar 进程)   │ │  Backend     │ │  Runtime (打包)  │     │
│  └──────────────────┘ └──────────────┘ └──────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2.5 通信协议（Wire Protocol）

> **决策**：JSON-RPC 2.0 over **stdio + Unix Domain Socket (UDS)** 双 transport（Windows 下用 Named Pipe），所有方法族（`gateway.*` / `session.*` / `client.tool.*` / `model.*` / `prompt.*` ...）共用**同一条**连接。
> 
> **背景**：v2 设计使用 WebSocket (ws://127.0.0.1:port) 作为 Desktop 的备用 transport。v3 借鉴 [opencode](https://github.com/opencode) 的 sidecar 架构思想，将 WebSocket 替换为 **UDS/Named Pipe**，消除 TCP loopback 的端口分配、防火墙、代理干扰问题，同时保持 JSON-RPC 协议不变。

### 2.5.1 选型

| 维度 | 选择 | 理由 |
|------|------|------|
| 消息格式 | **JSON-RPC 2.0** | 与现有 `tui_gateway` 完全一致；TUI / Desktop / ACP adapter 共用同一套 server；request/response/notification 三种语义齐全；错误模型标准化 |
| 编码 | **UTF-8 JSON, 行分隔（NDJSON）** | stdio 和 socket 均用 `\n` 分帧。无需自定义二进制 framing |
| 默认 transport | **stdio** | 内嵌 sidecar 场景：零配置、零端口、跟随子进程生命周期、不被防火墙/杀软拦截 |
| Desktop transport | **Unix Domain Socket (UDS) / Named Pipe** | 替代 WebSocket：无端口分配/冲突、无防火墙/代理干扰、无 TCP handshake 开销、进程隔离更清晰。Windows 用 Named Pipe，Unix 用 UDS |
| 连接拓扑 | **单连接多路复用** | `gateway.*`、`session.*`、`client.tool.*`、`model.*` 都跑在同一连接上，按 `method` 名前缀路由 |
| 不采用 | gRPC / Protobuf | 需要 codegen 三端同步、与现有 tui_gateway 不兼容、对截图等大对象的流式回传不比 JSON-RPC chunk 简单 |
| 不采用 | 双连接（AI 通道 + Native 通道分离） | 增加生命周期/会话关联复杂度，且没有性能或安全收益 |

### 2.5.2 消息分类

| 方向 | 类型 | 示例 |
|------|------|------|
| client → gateway | request（有 `id`，期待 response） | `gateway.hello`, `session.create`, `prompt.submit`, `client.register_tools` |
| gateway → client | response（带相同 `id`） | `result` 或 `error` |
| gateway → client | notification（无 `id`） | `message.delta`, `tool.start/progress/complete`, `approval.request` |
| gateway → client | request（有 `id`，期待 response） ◀── 反向调用 | `client.tool.invoke`（详见 §3） |
| client → gateway | response（带相同 `id`） | `client.tool.result` 通过响应或独立通知二选一（本设计采用**独立通知 `client.tool.result`**，便于支持 §3.4 流式 chunk） |
| 双向 | notification | `cancel`, heartbeat |

> **关键澄清**：`client.tool.result` 不复用 JSON-RPC response，而是独立 notification，原因是结果可能跨多条 `client.tool.result.chunk` 分片到达，无法塞进单一 response。`call_id` 字段做关联。

### 2.5.3 stdio Framing（TUI 专用）

```
client 进程 ◀──stdin──── newline-delimited JSON ────stdout──▶ gateway sidecar
              ◀──stderr────── 仅日志/诊断（不参与协议）──────
```

- 每行一条 JSON-RPC 消息（无 BOM、无 trailing comma）
- 长度 > 64 KB 的消息允许（典型情况：base64 编码截图）
- `stderr` 只用于诊断输出，由 §8 的 `GatewayLifecycleBridge.getLogs()` 收集

### 2.5.4 Socket Transport Framing（Desktop 专用）

Desktop 使用 **Unix Domain Socket (UDS)**（Linux/macOS）或 **Named Pipe**（Windows）作为 transport，替代 WebSocket。

**路径约定**：
- Linux/macOS：`$HERMES_HOME/run/gateway.sock`
- Windows：`\\.\pipe\hermes-gateway-{pid}`（pid 为 sidecar 进程 ID，避免冲突）

**消息分帧**：与 stdio 一致，每行一条 NDJSON。Socket 层不做额外 framing，直接按 `\n` 分割。

```
SolidJS (前端)  ←→  Tauri IPC  ←→  Rust UnixStream/NamedPipeClient  ←→  UDS/NamedPipe  ←→  Python asyncio
                                                                                                    │
                                                                                                    ▼
                                                                                           tui_gateway/server.py
```

**鉴权**：UDS/Named Pipe 的文件系统权限天然提供单用户隔离。Socket 文件目录 `HERMES_HOME/run/` 权限设为 `0700`，防止其他用户访问。无需额外 token 机制。

**优势对比**（vs v2 WebSocket）：
| 维度 | WebSocket (v2) | UDS/Named Pipe (v3) |
|------|---------------|---------------------|
| 端口分配 | 需动态分配/冲突检测 | 文件系统路径，无冲突 |
| 防火墙/代理 | 可能受系统代理干扰 | 完全 bypass |
| 连接开销 | TCP handshake + WS upgrade | 直接连接，零握手 |
| 进程关联 | 端口与进程无绑定 | socket 文件随进程销毁而清理 |
| 多 client | 允许多个 TCP 连接 | UDS 支持多 client（可选特性） |
| 调试 | 可用浏览器/ curl | 可用 `nc -U` / `socat` |

### 2.5.5 心跳与超时

| 机制 | stdio (TUI) | Socket (Desktop) |
|------|-------------|------------------|
| 心跳 | 每 15s 发 `gateway.ping` notification，30s 无响应判定挂起 | 同左（应用层心跳，`gateway.ping`） |
| 单 request 超时 | client 端默认 30s，可由调用方覆盖 | 同左 |
| `client.tool.invoke` 超时 | 由 `deadline_ms` 字段控制（§3.2）| 同左 |
| 连接断开 | sidecar 退出 → 触发 `GatewayLifecycleBridge.onCrash` | socket 断开 → 自动重连，最多 5 次指数退避 |
| 崩溃检测 | 进程退出码监控 | 进程退出码 + socket 断开事件双重监控 |

### 2.5.6 错误传播

JSON-RPC 标准错误码 + Hermes 扩展：

```jsonc
{ "jsonrpc": "2.0", "id": "...", "error": {
    "code": -32000,                     // Hermes 自定义起点
    "message": "permission denied",
    "data": {                           // 对应 §6.1 BridgeError
      "kind": "denied",
      "capability": "media_screenshot",
      "revocable": true
    }
}}
```

| Code 区间 | 含义 |
|----------|------|
| -32700 ~ -32600 | JSON-RPC 标准错误（parse / invalid request） |
| -32000 ~ -32099 | Gateway 业务错误（session 不存在、tool 未注册、配额耗尽） |
| -32100 ~ -32199 | client.tool 错误（denied / unavailable / timeout / native_error） |
| -32200 ~ -32299 | 协议协商错误（capability mismatch / version mismatch） |

### 2.5.7 协议版本

`gateway.hello` 必须带 `protocol_version: "1.0"`。Gateway 检查后回 `accepted_version`。前者高于后者时，client 必须以 `accepted_version` 行事；client 实现 N → 至少兼容 Gateway N-1。

### 2.5.8 Transport 插件化设计（Python 端）

**核心原则**：`tui_gateway/server.py` 中的 JSON-RPC handler 逻辑**零改动**，仅将 stdio 循环抽象为可插拔的 Transport 接口。

```python
# tui_gateway/transport/base.py
from abc import ABC, abstractmethod

class Transport(ABC):
    @abstractmethod
    async def read_message(self) -> str | None:
        """读取一行 NDJSON，返回 None 表示连接已关闭"""
        ...

    @abstractmethod
    async def write_message(self, msg: str) -> None:
        """写入一行 NDJSON（自动追加 \\n）"""
        ...

    @abstractmethod
    async def close(self) -> None:
        ...
```

**两种实现**：

| 实现 | 路径 | 适用场景 |
|------|------|---------|
| `StdioTransport` | `tui_gateway/transport/stdio.py` | TUI（默认）：`sys.stdin.readline()` / `sys.stdout.write()` |
| `UnixSocketTransport` | `tui_gateway/transport/unix_socket.py` | Desktop（Linux/macOS）：`asyncio.start_unix_server()` |
| `NamedPipeTransport` | `tui_gateway/transport/named_pipe.py` | Desktop（Windows）：`win32pipe` 或 `asyncio.start_server()` on pipe |

**启动入口**（`entry.py` 新增 `--transport` 参数）：

```python
# tui_gateway/entry.py
async def main():
    transport_type = os.environ.get("HERMES_GATEWAY_TRANSPORT", "stdio")
    if transport_type == "unix_socket":
        path = os.environ.get("HERMES_GATEWAY_SOCKET", f"{HERMES_HOME}/run/gateway.sock")
        transport = await UnixSocketTransport.bind(path)
    elif transport_type == "named_pipe":
        name = os.environ.get("HERMES_GATEWAY_PIPE", f"hermes-gateway-{os.getpid()}")
        transport = await NamedPipeTransport.bind(name)
    else:
        transport = StdioTransport()

    server = GatewayServer(transport)
    await server.run()
```

**关键设计点**：
1. `server.py` 只依赖 `Transport` 抽象，不感知底层是 stdio 还是 socket
2. 同一进程可接受多个 socket 连接（UDS 天然支持），每个连接独立运行 JSON-RPC 会话
3. socket 连接断开后自动清理，不影响其他连接或 stdio transport
4. `stderr` 日志输出统一保留，与 transport 类型无关

---

## 3. Native Tool Provider 协议（核心新增）

> **目的**：让 Gateway 能够把 Bridge 提供的 Native 能力当作普通 LLM tool 来调度，同时保持 Gateway 对客户端无感知。

### 3.1 协议总览

```
Desktop 启动 ──▶ Bridge 初始化 ──▶ 收集所有 Native capabilities
                                          │
                                          ▼
                          连接 Gateway (gateway.hello)
                                          │
                                          ▼
              client.register_tools([screenshot, clipboard_read, notify, ...])
                                          │
                                          ▼
                Gateway 把这些 tool 注册到当前 session 的 tool schema
                                          │
                                          ▼
              LLM 决定调用 screenshot ──▶ Gateway tool dispatch
                                          │
                                          ▼
              Gateway 发现是 client-tool ──▶ client.tool.invoke(call_id, args)
                                          │
                                          ▼
              Desktop ToolHandler ──▶ PermissionBroker.check()
                                          │
                                          ▼
                              Bridge.media.captureScreen()
                                          │
                                          ▼
              client.tool.result(call_id, {ok: true, data: ...})
                                          │
                                          ▼
                          Gateway 返回给 LLM 作为 tool result
```

### 3.2 JSON-RPC 方法族

**握手扩展（Gateway 端新增）**：

```jsonc
// client → gateway
{
  "method": "gateway.hello",
  "params": {
    "client_id": "desktop-v0.4.2",
    "capabilities": {
      "client_tools": true,        // 声明支持反向 tool 调用
      "approval_ui": true,
      "media": true,
      "version": "1.0"
    }
  }
}

// client → gateway
{
  "method": "client.register_tools",
  "params": {
    "tools": [
      {
        "name": "screenshot",
        "description": "Capture the current screen",
        "input_schema": { "type": "object", "properties": {...} },
        "permission_tier": "high",     // 见 §5
        "timeout_ms": 5000
      },
      {
        "name": "clipboard_read",
        "description": "Read text from system clipboard",
        "input_schema": { "type": "object" },
        "permission_tier": "medium",
        "timeout_ms": 1000
      }
    ]
  }
}

// gateway → client（LLM 触发 tool call 时反向调用）
{
  "method": "client.tool.invoke",
  "params": {
    "call_id": "tc_01HXY...",
    "tool_name": "screenshot",
    "args": {},
    "session_id": "sess_...",
    "deadline_ms": 5000
  }
}

// client → gateway（结果回传）
{
  "method": "client.tool.result",
  "params": {
    "call_id": "tc_01HXY...",
    "ok": true,
    "result": { "image": "data:image/png;base64,..." }
    // 失败时:
    // "ok": false,
    // "error": { "kind": "denied" | "unavailable" | "timeout" | "native_error", ... }
  }
}

// client → gateway（取消，例如用户关窗）
{
  "method": "client.tool.cancel",
  "params": { "call_id": "tc_01HXY..." }
}
```

### 3.3 关键约束

1. **Tool 注册仅在 session 创建前生效**（参见 §4），mid-session 不允许 `register_tools`，否则破坏 prompt cache。
2. **`call_id` 由 Gateway 生成**，与 LLM 的 tool_call_id 一致，便于追踪。
3. **`deadline_ms`**：Gateway 端硬超时；Desktop 必须在期限前 `result` 或 `cancel`，否则 Gateway 自动报 timeout 给 LLM。
4. **结果序列化**：大对象（截图、音频）使用 base64 或 `tool.result.chunk` 流式传输（见 §3.4）。
5. **错误模型**：统一使用 §6 定义的 `BridgeError`。

### 3.4 大对象流式回传（可选扩展）

```jsonc
// client → gateway
{ "method": "client.tool.result.chunk",
  "params": { "call_id": "...", "seq": 0, "data": "...", "final": false } }
{ "method": "client.tool.result.chunk",
  "params": { "call_id": "...", "seq": 1, "data": "...", "final": true } }
```

Gateway 内部缓存重组后再交给 LLM。

---

## 4. 客户端能力协商（Capability Negotiation）

### 4.1 握手流程

```
Desktop ──gateway.hello{capabilities}──▶ Gateway
Desktop ──client.register_tools([...])──▶ Gateway
                                          │
                                          ▼
                              Gateway 计算最终 tool schema
                              （内置 tools + client tools）
                                          │
                                          ▼
Desktop ──session.create──▶ Gateway ──▶ session 绑定 tool schema 快照
                                          │
                                          ▼
            后续 prompt 都使用这份快照，prompt cache 保持稳定
```

### 4.2 不变性约束（与 AGENTS.md 对齐）

| 约束 | 原因 |
|------|------|
| 同一 session 内 client tool 集合不可变 | Mid-session 增减 tool 会破坏 prompt cache |
| 切换 client（TUI ↔ Desktop）必须开新 session | 两端能力差异 → tool schema 差异 |
| `gateway.hello` 失败必须降级（不强制断连） | Gateway 老版本可能不支持 client.tool.*，需要降级到"无 client tool"模式 |

### 4.3 TUI 与 Desktop 的能力差异

| Capability | TUI | Desktop | 备注 |
|------------|-----|---------|------|
| `client_tools` | ❌ | ✅ | TUI 不实现 Native Tool Provider |
| `screenshot` | ❌ | ✅ | |
| `clipboard_read/write` | ❌ | ✅ | |
| `notify` | ❌ | ✅ | |
| `window` | ❌ | ✅ | |
| `approval_ui` | ✅ | ✅ | 两端都支持 |

> 详见 §11 "TUI 不实现 Bridge 的决策依据"。

---

## 5. PermissionBroker —— Capability Grant 模型（Q4=C）

### 5.1 模型定义

仿 macOS 隐私面板：用户在 Settings 里给某项 Capability 颁发**长期 grant**，Agent 调用时无需逐次确认；用户可随时撤销；高敏感能力首次使用时弹一次性 onboarding 提示。

```typescript
type PermissionState =
  | { state: 'granted'; granted_at: number; granted_by: 'user' | 'install_default' }
  | { state: 'denied'; denied_at: number }
  | { state: 'unset' };  // 首次调用时触发 onboarding

interface PermissionBroker {
  check(capability: string): Promise<'granted' | 'denied' | 'needs_prompt'>;
  request(capability: string, context: { reason: string; tool_name: string }): Promise<boolean>;
  revoke(capability: string): Promise<void>;
  list(): Promise<Record<string, PermissionState>>;
  onChange(callback: (cap: string, state: PermissionState) => void): UnsubscribeFn;
}
```

### 5.2 默认策略（安装时 seed）

| Capability | 默认 grant | 撤销难度 |
|------------|-----------|---------|
| `notify` | ✅ granted | 1 次点击 |
| `clipboard_write` | ✅ granted | 1 次点击 |
| `os_open_external` | ✅ granted | 1 次点击 |
| `clipboard_read` | unset → 首次 prompt | Settings |
| `filesystem_read` | unset → 首次 prompt + 路径白名单 | Settings |
| `filesystem_write` | unset → 首次 prompt + 路径白名单 | Settings |
| `process_spawn` | unset → 首次 prompt + 命令白名单 | Settings |
| `media_screenshot` | unset → 首次 prompt + OS 权限引导 | Settings |
| `media_record_audio` | unset → 首次 prompt + OS 权限引导 | Settings |

### 5.3 审计日志

每次 capability 调用都写入 `~/.hermes/desktop/permission-audit.log`：

```jsonc
{
  "ts": 1714000000,
  "session_id": "sess_...",
  "tool_call_id": "tc_...",
  "capability": "media_screenshot",
  "tool_name": "screenshot",
  "result": "granted" | "denied" | "auto_granted",
  "agent_reason": "User asked: 'what's on my screen'"
}
```

UI 提供日志查看面板（Settings → Privacy → Audit Log）。

### 5.4 与 Native Tool Provider 的集成点

```
client.tool.invoke ──▶ ToolHandler
                          │
                          ▼
              PermissionBroker.check(capability)
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
          granted    denied      needs_prompt
              │           │           │
              │           │           ▼
              │           │      弹窗 + 写入 grant
              │           │           │
              │           ▼           ▼
              │      返回 {ok:false,  根据用户选择
              │      error:denied}    继续/拒绝
              ▼
        Bridge 调用
```

### 5.5 OS 级权限的双层握手

`media_screenshot` 在 macOS 需要 Screen Recording 权限，在 Windows 需要弹窗确认。PermissionBroker 必须区分**应用层 grant**和**OS 层 grant**：

1. 应用层未 grant → 弹 Hermes 自己的 onboarding，解释 + 请求
2. 应用层 granted，但 OS 层未给 → 弹"请到系统设置开启 Screen Recording 权限"，提供 deep link

---

## 6. 错误模型与降级策略

### 6.1 统一错误类型

```typescript
type BridgeError =
  | { kind: 'unavailable'; capability: string; reason?: string }
  | { kind: 'denied'; capability: string; revocable: boolean }
  | { kind: 'unsupported_platform'; platform: string; required: string[] }
  | { kind: 'os_permission_required'; capability: string; deep_link?: string }
  | { kind: 'timeout'; deadline_ms: number }
  | { kind: 'native_error'; code: string; message: string }
  | { kind: 'cancelled' };

class BridgeException extends Error {
  constructor(public readonly bridgeError: BridgeError) { super(); }
}
```

### 6.2 `isAvailable()` 语义

`isAvailable()` 必须**不副作用、不弹窗、不消耗权限**，只检查：
- Tauri 后端是否暴露了对应的 Rust command
- 当前平台是否支持
- Capability 是否已在 PermissionBroker 注册

**不**检查用户是否已 grant —— 那是 `check()` 的职责。

### 6.3 降级矩阵

| 场景 | Bridge 行为 | Gateway 行为 | UI 行为 |
|------|-----------|-------------|---------|
| Tauri 后端缺方法（旧版本） | `isAvailable() → false` | tool 不注册 | UI 隐藏入口 |
| 平台不支持 | `unsupported_platform` error | tool result 包含 error | UI 显示"此功能仅 macOS 可用" |
| 用户拒绝授权 | `denied` error | tool result 包含 error | UI 提示 + 引导到 Settings |
| OS 权限未给 | `os_permission_required` error | tool result 包含 error | UI 弹 onboarding |
| 超时 | `timeout` error | tool result 包含 error | UI 显示"操作超时" |

### 6.4 Gateway 老版本不支持 `client.tool.*`

握手时若 Gateway 不识别 `client_tools` capability：
1. Desktop 不发 `client.register_tools`
2. Bridge 仍然可用于 UI 自身（如 Settings 保存配置）
3. Agent 无法调用 Native 能力，但其他功能正常

---

## 7. Bridge 模块清单（Q1=A：删除 LocalLLMBridge）

```typescript
interface BridgeCapability {
  readonly name: string;
  readonly version: string;          // 见 §10 versioning
  isAvailable(): Promise<boolean>;
  getMethods(): Promise<string[]>;   // 实际支持的方法名（用于前后端版本错位）
}

// ── FileSystemBridge ──────────────────────────────────────────
interface FileSystemBridge extends BridgeCapability {
  readonly name: 'filesystem';
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  watch(path: string, cb: (e: FileChangeEvent) => void): Promise<UnwatchFn>;
}
// 场景: Settings 保存 YAML、Memory 浏览、日志查看

// ── OSBridge ──────────────────────────────────────────────────
interface OSBridge extends BridgeCapability {
  readonly name: 'os';
  openExternal(url: string): Promise<void>;
  showNotification(title: string, body: string): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  getPlatform(): Promise<'windows' | 'macos' | 'linux'>;
  revealInFinder(path: string): Promise<void>;
}

// ── WindowBridge ──────────────────────────────────────────────
interface WindowBridge extends BridgeCapability {
  readonly name: 'window';
  getWindowState(): Promise<WindowState>;
  setWindowState(state: Partial<WindowState>): Promise<void>;
  toggleFullscreen(): Promise<void>;
  minimize(): Promise<void>;
  toggleAlwaysOnTop(): Promise<void>;
  setOpacity(opacity: number): Promise<void>;
}

// ── UpdaterBridge ─────────────────────────────────────────────
interface UpdaterBridge extends BridgeCapability {
  readonly name: 'updater';
  checkForUpdate(): Promise<UpdateInfo | null>;
  installUpdate(): Promise<void>;
  onUpdateAvailable(cb: (info: UpdateInfo) => void): UnsubscribeFn;
}

// ── ProcessBridge ─────────────────────────────────────────────
interface ProcessBridge extends BridgeCapability {
  readonly name: 'process';
  spawn(cmd: string, args: string[], opts?: SpawnOptions): Promise<ProcessHandle>;
  exec(cmd: string): Promise<{ stdout: string; stderr: string; code: number }>;
}

// ── MediaBridge ───────────────────────────────────────────────
interface MediaBridge extends BridgeCapability {
  readonly name: 'media';
  captureScreen(): Promise<Blob>;
  captureWindow(windowId?: string): Promise<Blob>;
  recordAudio(durationMs?: number): Promise<Blob>;
}

// ── GatewayLifecycleBridge（Q2=A 内嵌 sidecar 必须）────────────
interface GatewayLifecycleBridge extends BridgeCapability {
  readonly name: 'gateway_lifecycle';
  status(): Promise<{ running: boolean; pid?: number; version?: string }>;
  start(): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  getLogs(tailLines?: number): Promise<string>;
  onCrash(cb: (info: CrashInfo) => void): UnsubscribeFn;
  // 健康检查 + 自动重启在 Bridge 内部循环
}
```

### 7.1 删除说明

**LocalLLMBridge 已删除**。所有 LLM 调用（包括 Ollama、llama.cpp 等本地模型）统一走 Gateway 的 LLM Router。

理由：
- 避免 Desktop 和 Gateway 各自维护一套 message/tool/context 状态
- 用户切换"轻量对话 → 加 tool" 时不会丢历史
- 单一调试路径

实现细节（Gateway 端已具备）：
- Gateway 启动时按需 lazy-init tool/memory/MCP（首次调用才加载）
- `model.set('ollama/llama3')` 自动路由到本地 Ollama
- 模型管理（list/pull/delete）通过 Gateway 的 `model.*` JSON-RPC 暴露

---

## 7.5 Platform Manager —— 消息平台管理模块

> **背景**：Hermes 有两个独立的 Gateway 进程：
> 1. `tui_gateway` —— 通过 UDS/stdio 与 Desktop 通信，提供 AI Agent 能力（session、prompt、config、tools 等 62 个 JSON-RPC 方法）
> 2. `platform gateway` —— 独立进程，管理 20 个外部消息平台（Telegram、Discord、Slack、WhatsApp、飞书等）的连接和消息收发
>
> platform gateway **没有运行时 CRUD API**，配置静态存储在 `~/.hermes/config.yaml` 中，修改后需要重启进程才能生效。
>
> **目标**：Desktop 需要一个 UI 模块，让用户能够查看、配置和管理 platform gateway 的连接，而无需手动编辑 YAML 或命令行操作。

### 7.5.1 架构定位

Platform Manager **不是新的 gateway**，也不属于 Bridge 层。它是 Desktop 的一个**独立功能模块**，通过**三条现有路径**组合实现对 platform gateway 的管理：

```
Desktop (SolidJS)
  │
  ├──▶ 路径 1: tui_gateway (UDS) ──▶ config.get/set ──▶ ~/.hermes/config.yaml
  │      （读写 platform 配置）
  │
  ├──▶ 路径 2: Tauri Rust ──▶ CLI spawn ──▶ `hermes gateway start/stop/restart`
  │      （启停 platform gateway 进程）
  │
  └──▶ 路径 3: HTTP poll ──▶ APIServerAdapter ──▶ `GET /health`
         （获取运行时状态）
```

### 7.5.2 三条技术路径

| 需求 | 路径 | 技术实现 | 说明 |
|------|------|---------|------|
| **查/改 platform 配置** | 复用 tui_gateway | `gateway.config.get("platforms")` / `config.set("platforms.xxx", {...})` | 直接读写 `config.yaml`，修改后提示用户"需重启 gateway 生效" |
| **启停 platform gateway** | Tauri Rust CLI spawn | `Command::new("hermes").args(["gateway", "start/stop/restart"])` | 复用 `hermes_cli/gateway.py` 的子命令，无需重复实现生命周期逻辑 |
| **查 platform 运行状态** | HTTP 轮询 | `fetch("http://127.0.0.1:8642/health")`（APIServerAdapter） | 轮询间隔 10s，结合 `gateway_state.json` 文件监控做 fallback |

### 7.5.3 页面设计

作为独立页面，路由：`/platforms`（或放在 Settings → Platforms 标签下）。

**UI 结构**：

```
┌──────────────────────────────────────────────────────────────┐
│  Platforms                                                    │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌───────────────────────────────────┐  │
│  │ Platform List   │  │ Platform Detail / Editor          │  │
│  │                 │  │                                   │  │
│  │ ● Telegram      │  │  Status:   🟢 online / 🔴 offline │  │
│  │ ● Discord       │  │  Enabled:  [☑]                    │  │
│  │ ● Slack         │  │  Token:    [****************]     │  │
│  │ ● WhatsApp      │  │  Home:     #general               │  │
│  │ ● Feishu        │  │  Reply:    [thread] [channel]     │  │
│  │ ...             │  │                                   │  │
│  │                 │  │  [Save] [Restart Gateway]         │  │
│  └─────────────────┘  └───────────────────────────────────┘  │
│                                                              │
│  Gateway Process: 🟢 Running (PID: 12345)  [Stop] [Restart] │
│  Last check: 10s ago                                         │
└──────────────────────────────────────────────────────────────┘
```

### 7.5.4 Platform 状态模型

每个平台有**三层状态**：

| 状态层 | 来源 | 值 | 说明 |
|--------|------|-----|------|
| **配置态** | `config.yaml` | `enabled: true/false` | 是否启用该平台的连接 |
| **运行态** | HTTP health / gateway_state.json | `online` / `offline` / `error` | 实际连接状态 |
| **错误态** | gateway logs | `auth_error` / `network_error` / `rate_limited` | 最近一次错误原因 |

**状态流转**：

```
config.enabled=false ──▶ 显示 "Disabled"（灰色）
config.enabled=true ──▶ 查询运行态
  ├── online  ──▶ 🟢 "Connected"
  ├── offline ──▶ 🟡 "Disconnected"（等待 reconnect watcher）
  └── error   ──▶ 🔴 "Error: {reason}"（显示最近日志片段）
```

### 7.5.5 代码目录结构（新增）

```
desktop/src/
├── modules/
│   └── platforms/                  ◀── 新增：Platform Manager 页面
│       ├── index.tsx               # 主页面（PlatformList + PlatformDetail）
│       ├── PlatformList.tsx        # 左侧平台列表卡片
│       ├── PlatformDetail.tsx      # 右侧详情/编辑器
│       ├── PlatformStatusBadge.tsx # 状态徽章组件
│       └── platforms.module.css    # 样式
│
├── services/
│   └── platform-manager/           ◀── 新增：平台管理服务
│       ├── types.ts                # PlatformConfig, PlatformStatus, PlatformError
│       ├── config-client.ts        # 封装 tui_gateway config.get/set
│       ├── process-client.ts       # 封装 Tauri CLI spawn（启停 gateway）
│       ├── status-client.ts        # 封装 HTTP health 轮询 + gateway_state.json 读取
│       └── index.ts                # 统一 facade：PlatformManagerService
│
desktop/src-tauri/src/
├── commands.rs                     # 现有
├── platform_manager.rs             ◀── 新增：Rust 层 CLI spawn + gateway_state.json 读取
│   # - gateway_start()
│   # - gateway_stop()
│   # - gateway_restart()
│   # - read_gateway_state() -> GatewayState
│   # - read_gateway_logs(tail: usize) -> String
```

### 7.5.6 关键实现细节

**配置读写（复用 tui_gateway）**：

```typescript
// services/platform-manager/config-client.ts
import { getGateway } from '@/stores/context';

export async function getPlatformConfig(platform: string): Promise<PlatformConfig> {
  const gateway = getGateway();
  const config = await gateway.config.get();
  return config.platforms?.[platform] ?? { enabled: false };
}

export async function setPlatformConfig(
  platform: string,
  patch: Partial<PlatformConfig>
): Promise<void> {
  const gateway = getGateway();
  const current = await getPlatformConfig(platform);
  await gateway.config.set(`platforms.${platform}`, { ...current, ...patch });
}
```

**进程启停（Tauri Rust CLI）**：

```rust
// src-tauri/src/platform_manager.rs
use std::process::{Command, Stdio};
use tauri::command;

#[command]
async fn gateway_start() -> Result<u32, String> {
    let child = Command::new("hermes")
        .args(["gateway", "start", "--daemon"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(child.id())
}

#[command]
async fn gateway_stop() -> Result<(), String> {
    Command::new("hermes")
        .args(["gateway", "stop"])
        .output()
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

**状态轮询（HTTP + 文件 fallback）**：

```typescript
// services/platform-manager/status-client.ts
const HEALTH_URL = 'http://127.0.0.1:8642/health';
const STATE_FILE = '~/.hermes/gateway_state.json';

export async function getGatewayStatus(): Promise<GatewayStatus> {
  try {
    // 优先尝试 HTTP health endpoint
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      return { running: true, pid: data.pid, platforms: data.platforms };
    }
  } catch {
    // fallback: 读取 gateway_state.json
  }

  // fallback: 读取本地状态文件
  const state = await readFile(STATE_FILE); // Tauri command
  return parseGatewayState(state);
}
```

### 7.5.7 与现有模块的关系

| 模块 | Platform Manager 的依赖 | 关系 |
|------|------------------------|------|
| **GatewayClient** (tui_gateway UDS) | `config.get/set` | 复用现有连接，不新增 gateway |
| **Bridge** | 无 | Platform Manager 不属于 Bridge 层 |
| **Sidecar Manager** (§8) | 无 | Platform gateway 是用户自行管理的独立进程，不由 Desktop 内嵌 |
| **Settings** | 可选 | Platform Manager 可嵌入 Settings → Platforms 标签，或独立路由 |

### 7.5.8 边界和限制

1. **配置修改不即时生效**：`config.set` 只写 YAML，platform gateway 需重启才能加载新配置。UI 必须明确提示用户。
2. **platform gateway 不是 sidecar**：Desktop 不负责 platform gateway 的打包和生命周期（与 §8 的 tui_gateway sidecar 不同）。用户需自行安装 `hermes` CLI。
3. **HTTP health 可能不可用**：如果用户没有启用 `API_SERVER` 平台适配器，`/health` 端点不存在。此时 UI 降级为只显示配置态，隐藏运行态。
4. **不支持 mid-session 平台切换**：platform gateway 重启会断开所有平台连接，正在进行的对话会中断。

---

## 8. Gateway Sidecar 管理（Q2=A）

### 8.1 打包策略

| 平台 | Python runtime | 打包工具 |
|------|---------------|---------|
| macOS | Python 3.12 (universal2) | `tauri-bundler` resources + PyInstaller --onedir |
| Windows | Python 3.12 (x64) | NSIS installer + PyInstaller --onedir |
| Linux | Python 3.12 (musl/glibc 双版本) | AppImage + PyInstaller --onedir |

Python 解释器 + `tui_gateway` + 必要依赖打包到 `resources/python-runtime/`。

### 8.2 Sidecar 生命周期

```
App start ──▶ GatewayLifecycleBridge.start()
                  │
                  ▼
          spawn embedded python with tui_gateway
                  │
                  ▼
          Gateway creates UDS/Named Pipe socket
                  │
                  ▼
          Gateway client connects to socket
                  │
                  ▼
          gateway.hello + register_tools (§3)
                  │
                  ▼
          [运行中：心跳 + 崩溃监听]
                  │
                  ▼
App quit ──▶ Gateway.shutdown() ──▶ wait 2s ──▶ kill if alive
```

### 8.3 崩溃恢复

- Sidecar Manager 双重监控：**child exit code** + **socket 断开事件**
- 非 0 退出或 socket 异常断开 → 写入崩溃 dump → 自动重启（最多 3 次/分钟，超过则停止重启并提示用户）
- 重启后**不自动恢复 session**，让用户手动 `/resume`（避免死循环重放导致再次崩溃）
- socket 文件在 sidecar 启动时创建，进程退出时由操作系统自动清理（UDS）或由 Manager 显式清理（Named Pipe）

### 8.4 用户自带 Gateway（高级）

允许 power user 通过环境变量 `HERMES_DESKTOP_USE_EXTERNAL_GATEWAY=1` 跳过内嵌 sidecar，连接到自己装的 `hermes` 实例。连接方式仍通过 UDS socket（外部 Gateway 需自行创建 socket 文件并暴露路径），保持协议一致性。这是逃生舱口，不在主流程文档中宣传。

---

## 9. 代码目录结构

```
desktop/src/
├── services/
│   ├── gateway/
│   │   ├── types.ts
│   │   ├── client.ts
│   │   ├── mock-adapter.ts
│   │   ├── transport.ts
│   │   ├── transport-stdio.ts
│   │   ├── transport-socket.ts      ◀── 新增：UDS/Named Pipe transport（替代 transport-ws.ts）
│   │   ├── tool-handler.ts        ◀── 新增：处理 client.tool.invoke
│   │   └── index.ts
│   │
│   ├── bridge/
│   │   ├── types.ts               # BridgeCapability + BridgeError
│   │   ├── factory.ts             # BridgeFactory（mode: tauri | mock）
│   │   ├── context.ts             # SolidJS DI: getBridge()
│   │   ├── permission-broker.ts   ◀── 新增 §5
│   │   ├── audit-log.ts           ◀── 新增 §5.3
│   │   │
│   │   ├── filesystem.ts
│   │   ├── os.ts
│   │   ├── window.ts
│   │   ├── updater.ts
│   │   ├── process.ts
│   │   ├── media.ts
│   │   ├── gateway-lifecycle.ts   ◀── 新增 §8
│   │   │
│   │   ├── __mocks__/             ◀── 新增：每个 Bridge 的 Mock 实现
│   │   │   ├── filesystem.mock.ts
│   │   │   ├── os.mock.ts
│   │   │   └── ...
│   │   │
│   │   └── client-tools/          ◀── 新增：Bridge → client tool 适配
│   │       ├── registry.ts        # 把 Bridge 方法包装成 client tool schema
│   │       ├── screenshot.ts
│   │       ├── clipboard.ts
│   │       ├── notify.ts
│   │       └── ...
│   │
│   └── sidecar/
│       └── manager.ts             ◀── 新增 §8 sidecar lifecycle
│
├── stores/
│   ├── context.ts
│   ├── bridge-context.ts          ◀── 新增
│   └── ...
│
├── App.tsx                         # 启动顺序见 §12
└── ...

desktop/src-tauri/
├── src/
│   ├── commands.rs                 # 现有 Tauri commands → 迁移到 bridge_*.rs
│   ├── bridge_filesystem.rs        ◀── 新增
│   ├── bridge_os.rs
│   ├── bridge_window.rs
│   ├── bridge_media.rs
│   ├── bridge_process.rs
│   ├── bridge_updater.rs
│   ├── bridge_gateway_lifecycle.rs
│   └── permission_storage.rs       ◀── grant 持久化
└── resources/
    └── python-runtime/             ◀── §8.1 内嵌 Python
        ├── bin/
        ├── lib/
        └── tui_gateway/

desktop/tests/
├── bridge/
│   ├── filesystem.test.ts
│   ├── permission-broker.test.ts
│   └── ...
├── gateway/
│   └── tool-handler.test.ts
└── e2e/
    └── client-tool-roundtrip.test.ts   ◀── 端到端验证 §3 协议
```

---

## 10. Capability Versioning

### 10.1 版本声明

每个 Bridge 实现声明 `version: string`（semver），后端 Tauri command 也带版本：

```rust
#[tauri::command]
fn bridge_filesystem_version() -> &'static str { "1.2.0" }
```

### 10.2 兼容性检查

```typescript
// BridgeFactory 启动时
const expected = '1.2.0';
const actual = await invoke('bridge_filesystem_version');
if (semver.major(actual) !== semver.major(expected)) {
  // 主版本不兼容 → 标记为 unavailable，日志告警
  bridge.markUnavailable('filesystem', `version mismatch: ${actual} vs ${expected}`);
}
```

### 10.3 方法级降级

`getMethods()` 让 frontend 知道后端实际暴露了哪些方法。新方法在老后端上调用前先检查：

```typescript
const methods = await bridge.media.getMethods();
if (!methods.includes('recordAudio')) {
  // UI 隐藏录音按钮
}
```

### 10.4 与 §3 client tool 注册的联动

`registerTools` 时只注册 `getMethods()` 实际支持的方法对应的 client tool，避免给 LLM 暴露不存在的能力。

---

## 11. TUI 不实现 Bridge 的决策依据（Q5=A）

| 维度 | 结论 |
|------|------|
| 范围 | TUI 完全没有 Bridge layer |
| Native 能力 | 通过 Gateway 内置 tool 提供（filesystem、bash 等已有） |
| 客户端能力声明 | TUI 在 `gateway.hello` 中声明 `client_tools: false` |
| Agent 提示 | LLM 调用 Desktop-only tool 时 Gateway 返回 `unavailable` 错误，由 LLM 自行说明"需要在 Desktop 中使用" |
| 未来扩展 | 不排除补充极少数能力（剪贴板），但不在本设计范围内 |

理由：
- TUI 已有 `pyperclip`、`subprocess` 等 Python 能力可在 Gateway tool 中使用
- 避免维护两套 Native tool 实现
- 截图/窗口管理等核心 Bridge 能力 TUI 本就无法支持

---

## 12. 启动时序图

```
┌────────┐  ┌────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐
│App.tsx │  │Sidecar │  │PermBroker│  │ Bridge   │  │ Gateway  │  │ Tauri  │
└───┬────┘  └────┬───┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬───┘
    │            │           │             │            │             │
    │ 1. App boot                                                      │
    │ 2. PermissionBroker.load() (read grants from disk)               │
    │────────────────────────▶│                                         │
    │                         │                                         │
    │ 3. BridgeFactory.init(mode='tauri')                              │
    │──────────────────────────────────────▶│                           │
    │                                       │                           │
    │ 4. Sidecar.start()                                               │
    │────────────▶│                                                    │
    │             │ spawn embedded python (tui_gateway)                │
    │             │                                                    │
    │ 5. GatewayClient.connect(socket)                                 │
    │────────────────────────────────────────────────▶│                │
    │                                                 │                │
    │ 6. gateway.hello{capabilities: {client_tools: true, ...}}        │
    │                                                 │                │
    │ 7. client.register_tools([...])                                  │
    │    (Bridge methods ∩ getMethods() ∩ permission tier)             │
    │                                                                  │
    │ 8. initStores(gateway, bridge, permBroker)                       │
    │                                                                  │
    │ [App Ready]                                                      │
    │                                                                  │
    │ 9. 用户交互：                                                    │
    │    - UI 直接用 Bridge（settings 保存、文件浏览）                 │
    │    - Agent 通过 Gateway → client.tool.invoke → Bridge            │
    │    - 敏感能力先过 PermissionBroker                               │
    │                                                                  │
    │ 10. App quit                                                     │
    │     - GatewayClient.disconnect()                                 │
    │     - Sidecar.stop() (graceful + 2s timeout)                     │
    │     - Bridge unwatchAll() / unsubscribeAll()                     │
```

### 12.1 失败/降级分支

- **Sidecar 启动失败** → App 仍可启动（degraded mode）：UI 可用，但聊天功能禁用，提示用户查看 sidecar logs
- **Gateway 老版本不识别 `client_tools`** → §6.4 降级
- **PermissionBroker 持久化文件损坏** → 备份后重建为空，不阻塞启动
- **Bridge 某个 capability `isAvailable() = false`** → 静默跳过该 client tool 注册，UI 隐藏对应入口

---

## 13. 测试与 Mock 策略

### 13.1 单元测试

每个 Bridge 实现都有对应的 `*.test.ts`，使用 Tauri command mock：

```typescript
// bridge/__mocks__/filesystem.mock.ts
export class MockFileSystemBridge implements FileSystemBridge {
  readonly name = 'filesystem';
  readonly version = '1.2.0';
  private files = new Map<string, string>();
  async readFile(path: string) { return this.files.get(path) ?? throw ...; }
  // ...
}
```

### 13.2 组件测试

`BridgeFactory.create({ mode: 'mock' })` 返回所有 Mock 实现，Storybook 和 vitest 组件测试统一使用。

### 13.3 端到端测试

`tests/e2e/client-tool-roundtrip.test.ts` 启动真实 sidecar，验证：
1. `gateway.hello` 协商成功
2. `register_tools` 被 Gateway 接收并出现在 tool schema
3. 触发 LLM mock 返回 tool_call → `client.tool.invoke` 正确路由到 MockBridge
4. 结果回传 → LLM 看到 tool result

### 13.4 PermissionBroker 测试矩阵

| 状态 | 行为 | 测试 case |
|------|-----|---------|
| `unset` | 弹 prompt | ✓ |
| `granted` | 直接通过 | ✓ |
| `denied` | 返回 denied error | ✓ |
| OS 权限未给 | 返回 os_permission_required | ✓ |
| Grant 后 revoke | 下次调用回到 unset | ✓ |
| 审计日志写入 | 每次调用 1 条记录 | ✓ |

---

## 14. 与现有代码的迁移

| 现有代码 | 当前位置 | 迁移到 |
|---------|---------|--------|
| `read_file` | `src-tauri/src/commands.rs:38` | `bridge_filesystem.rs` + `Bridge.filesystem.readFile()` |
| `write_file` | `src-tauri/src/commands.rs:59` | `bridge_filesystem.rs` + `Bridge.filesystem.writeFile()` |
| `list_dir` | `src-tauri/src/commands.rs:73` | `bridge_filesystem.rs` + `Bridge.filesystem.listDir()` |
| `open_external` | `src-tauri/src/commands.rs:90` | `bridge_os.rs` + `Bridge.os.openExternal()` |
| `get_platform` | `src-tauri/src/commands.rs:96` | `bridge_os.rs` + `Bridge.os.getPlatform()` |
| `spawn_process` | `src-tauri/src/commands.rs:109` | `bridge_process.rs` + `Bridge.process.spawn()` |
| `check_for_updates` | `src-tauri/src/updater.rs:13` | `bridge_updater.rs` + `Bridge.updater.checkForUpdate()` |
| `install_update` | `src-tauri/src/updater.rs:46` | `bridge_updater.rs` + `Bridge.updater.installUpdate()` |

### 14.1 迁移策略

**双路径并存窗口（2 个 minor 版本）**：
1. 新 Bridge API 上线，旧 Tauri command 标记 `@deprecated`
2. 所有调用方迁移到 Bridge API
3. 下下个 minor 删除旧 command

回滚开关：环境变量 `HERMES_DESKTOP_LEGACY_COMMANDS=1` 强制使用旧路径，便于线上紧急回滚。

---

## 15. 实施顺序（Implementation Roadmap）

| 阶段 | 内容 | 阻塞条件 |
|------|------|---------|
| **P0 基础设施** | `BridgeCapability` 接口、`BridgeError`、`BridgeFactory`、Mock 体系、tests/ 骨架 | 无 |
| **P1 PermissionBroker** | grant 持久化、审计日志、Settings UI、OS 权限 deep link | P0 |
| **P2 现有能力迁移** | 把 §14 表格里的 7 个 command 迁到 Bridge，保留 deprecation | P0 |
| **P2.5 Platform Manager** | Platform Manager 模块：config 读写、进程启停、状态轮询、UI 页面 | P0 |
| **P3 Transport 插件化** | Gateway 端抽象 Transport 接口：`StdioTransport` / `UnixSocketTransport` / `NamedPipeTransport`；Desktop 端实现 `transport-socket.ts` | P0 |
| **P3.5 Sidecar Manager** | 内嵌 Python 打包、生命周期管理、崩溃恢复、socket 文件管理 | P3 |
| **P4 Native Tool Provider 协议** | Gateway 端新增 `client.tool.*`、capability registry；Desktop 端 ToolHandler | P3.5 |
| **P5 Bridge → client tool 适配** | screenshot、clipboard、notify 三个 MVP capability | P1, P4 |
| **P6 GatewayLifecycleBridge** | Settings 里的 sidecar 状态/重启 UI | P3.5 |
| **P7 完整 Bridge 套件** | window、updater、media 全量上线 | P5 |
| **P8 LocalLLMBridge 删除** | 确认 Gateway 端 Ollama 路由稳定后删除 | 独立任务 |

---

## 16. 总结

| 问题 | 答案 |
|------|------|
| Desktop 和 TUI 的关系 | **平行同级**，都是 Gateway 客户端 |
| Gateway 的职责 | **AI Agent 通道**：LLM、Tool、MCP、Memory（含本地模型） |
| Bridge 的职责 | **Native 通道**：文件、OS、窗口、媒体、sidecar lifecycle |
| Gateway ↔ Bridge 协作机制 | **`client.tool.*` 协议**：Desktop 注册 client tool，Gateway 反向调用 |
| 通信协议 | **JSON-RPC 2.0 over stdio + UDS/Named Pipe**，单连接多路复用（§2.5） |
| Native 能力授权方式 | **Capability Grant**（仿 macOS 隐私模型）+ 审计日志 |
| Python Gateway 部署 | **内嵌 sidecar**，安装包自带 Python runtime |
| LocalLLMBridge | **已删除**，本地模型统一走 Gateway |
| TUI 是否有 Bridge | **没有**，需要 Native 能力时由 Gateway tool 提供 |
| Cache 一致性保护 | **Tool 集合在 session 边界冻结**，mid-session 不变 |
| 错误模型 | 统一 `BridgeError` + 降级矩阵（§6） |
| Platform Manager | **独立功能模块**：通过三条路径（tui_gateway config + Tauri CLI spawn + HTTP health）管理 platform gateway 的 20 个平台连接（§7.5） |
