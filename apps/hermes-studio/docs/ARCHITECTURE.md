# Hermes Studio Architecture

Hermes Studio is an Electron application with a SolidJS renderer and a
desktop-owned Python sidecar. Electron main is the only privileged process.
The sandboxed renderer reaches native capabilities through the narrow, typed
`window.hermesStudio` API installed by preload.

Task 3 implements and freezes the native host contract. Renderer call sites
still use Tauri until Task 4 switches them to that contract; the bridge is
therefore implemented and tested but not yet the renderer's primary path.

## Process and trust boundaries

```text
untrusted/remote content
        |
        v
+------------------------+      frozen IPC      +-------------------------+
| SolidJS renderer       | <------------------> | Electron main           |
| sandbox + no Node      |  window.hermesStudio | validates every request |
+------------------------+                      +-----------+-------------+
                                                            |
                         +----------------------------------+-------------------+
                         |                                  |                   |
                         v                                  v                   v
                 Python sidecar                    local filesystem      OS services
                 loopback + bearer                 contained roots       PTY/dialog/etc.
```

| Boundary | Contract |
| --- | --- |
| Renderer to preload | `contextBridge` exposes one deeply frozen object. No `ipcRenderer`, Node, filesystem, shell, or process primitive crosses the boundary. |
| Preload to main | Named channels from `src/shared/native-bridge.ts`; one request payload; `{ok,value}` or `{ok:false,error:{code,message}}` response. |
| IPC sender to handler | Sender must be the current main window and its frame URL must be exactly `hermes-studio://app` or the validated development origin. |
| Main to sidecar | `127.0.0.1` only, random API bearer token, random separate workspace-grant token. |
| Main to disk | Hermes Home relative paths, managed clipboard assets, and explicitly selected workspace roots only. Canonical paths and symlinks are checked before use. |
| Renderer to local assets | Random expiring `hermes-studio-asset://` handles. Filesystem paths are never embedded in protocol URLs. |

The complete renderer contract and command-by-command migration ledger are in
[NATIVE_BRIDGE.md](./NATIVE_BRIDGE.md).

## BrowserWindow and origin policy

The window is frameless and uses `contextIsolation: true`, `sandbox: true`,
`webSecurity: true`, `nodeIntegration: false`, and
`allowRunningInsecureContent: false`. Production content is served by the
privileged `hermes-studio://app/` protocol rather than `file://`. Development
accepts only `http://127.0.0.1:1420` or `http://localhost:1420`; credentials,
other ports, paths, queries, and fragments are rejected.

Navigation, redirects, new windows, and webview attachment are denied. Both
permission request and permission check handlers default-deny everything except
audio-only media requested by the trusted app origin. The macOS package declares
the corresponding microphone usage description.

App responses receive a strict CSP, `Referrer-Policy: no-referrer`, and
`X-Content-Type-Options: nosniff`. Production script policy is self-only.
Development adds only the exact Vite HTTP/WebSocket origin and development-only
`unsafe-eval`. Backend connections add only the exact active loopback sidecar
origin. Object, base, ancestor, and form capabilities are disabled.

## Startup and recovery

1. Register privileged app and asset schemes before Electron is ready.
2. Claim the single-instance lock; a second launch focuses the existing window.
3. Select a Studio-specific Electron `userData` directory and configure the
   default session's permissions and security headers.
4. Register protocols, native services, validated IPC handlers, and lifecycle
   event forwarding.
5. Create and show the window independently of backend readiness.
6. Start the sidecar asynchronously. Failure produces a typed lifecycle event
   while the shell remains available in degraded mode.

Electron main creates one `SidecarManager` and is the only owner of its process.
In development it runs this command from `apps/hermes-studio`:

```bash
uv run --directory sidecar python -m daemon
```

In a packaged app it runs
`process.resourcesPath/sidecar/daemon` (`daemon.exe` on Windows). The manager
sets `DESKTOP_BACKEND_PORT=0`, generates separate cryptographically random API
and workspace-grant tokens, and waits for `READY <actual-port>` on stdout.

The Python process binds only `127.0.0.1`. Uvicorn's bound socket is the source
of the announced port, eliminating the reserve-then-bind race. Main constructs
the backend URL as `http://127.0.0.1:<port>` and probes
`/desktop/api/health` on loopback.

Three consecutive failed probes trigger a restart. Restart delays are
exponential (1, 2, 4, 8, 16 seconds, capped at 30 seconds), with no more than
five attempts in a rolling 60-second window. Initial spawn, READY timeout, and
pre-READY exit failures enter the same bounded background recovery policy.
`ready`, `unhealthy`, `restarted`, and `failed` lifecycle events are forwarded
to bridge subscribers. Because every spawn uses port zero and the document CSP
names the exact active backend origin, a successful origin change reloads the
renderer after delivering the lifecycle event; startup then re-subscribes and
reads the new sidecar information.

Sidecar stderr is appended to
`$HERMES_HOME/logs/hermes-studio.log` (default `~/.hermes`). Known generated
secrets, Authorization values, URL credentials, and common token/key/password
parameters are redacted before writing.

## Native service ownership

- Hermes Home reads, writes, and listings accept relative paths only, resolve
  symlinks, enforce containment, cap content, require UTF-8 text, and write
  atomically.
- Workspace selection uses Electron's native directory dialog. Main retains a
  private grant and sends the canonical cwd to the sidecar with both API and
  workspace-grant authentication; the grant never appears in bridge state.
- Clipboard and persisted image services validate image type and size. Remote
  clipboard downloads resolve and pin public IP addresses, reject private or
  reserved networks, revalidate redirects, time out, and enforce byte limits.
- PTYs are keyed by random IDs, use bounded dimensions/input, scrub sensitive
  environment entries, route data/exit/error events by ID, and are all stopped
  during shutdown.
- Window geometry is persisted only after validating that it remains visible on
  a current display. Window dragging uses trusted CSS `-webkit-app-region: drag`
  regions because Electron has no equivalent safe programmatic move API.
- Native notifications focus the existing window on interaction. Action buttons
  are enabled on macOS; other hosts show the notification without action buttons
  and report that actions are unsupported.

## Shutdown

`before-quit` is intercepted once. Main saves window state, closes PTYs and
notifications, revokes opaque asset handles and workspace grants, and awaits
sidecar shutdown before allowing Electron to quit. Sidecar shutdown wakes any
pending restart backoff, waits for in-flight cleanup, and targets only the child
created by this manager: its detached process group on POSIX or the owned PID's
tree on Windows. No process-name-wide kill is used.

## Packaging boundary

PyInstaller builds only for the runner's native OS and architecture. The build
entry stages exactly one executable at `sidecar/dist/electron/daemon[.exe]`;
the staging directory is cleared first so output from another host cannot leak
into the package. electron-builder copies it to packaged
`resources/sidecar`. `node-pty` native files are unpacked from ASAR.
Cross-compiling a PyInstaller binary is unsupported; CI uses native macOS,
Windows, and Linux runners.
