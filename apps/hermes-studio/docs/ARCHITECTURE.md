# Hermes Studio Architecture

Hermes Studio is an Electron application with a SolidJS renderer and a
desktop-owned Python sidecar. Electron main is the only privileged process.
The sandboxed renderer reaches native capabilities through the narrow, typed
`window.hermesStudio` API installed by preload.

The shell choice and alternatives are recorded in
[ADR-001](./decisions/ADR-001-electron-shell.md).

The native host contract is the renderer's only production path for privileged
operations. `src/services/native-host.ts` detects the frozen bridge and exposes
a scoped injection seam for Vitest and Playwright; it does not recreate raw
invoke/listen primitives. Browser preview remains native-free.

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
| Renderer to preload | `contextBridge` exposes one deeply frozen object. No `ipcRenderer`, Node, filesystem, shell, raw `webUtils`, or process primitive crosses the boundary. The one OS-drop method accepts original `File` objects and synchronously resolves them inside preload. |
| Preload to main | Named channels from `src/shared/native-bridge.ts`; one request payload; `{ok,value}` or `{ok:false,error:{code,message}}` response. |
| IPC sender to handler | Sender must be the current main window's exact `webContents.mainFrame` and its URL must be exactly `hermes-studio://app` or the validated development origin. Same-origin subframes are rejected. |
| Main to sidecar | `127.0.0.1` only, random API bearer token, random separate workspace-grant token. |
| Main to disk | Hermes Home relative paths, managed clipboard assets, per-session attachment staging, and that session's selected workspace root only. Reads/copies are descriptor-bound; writes and listings use immediate canonical and inode revalidation. |
| Renderer to local assets | Random expiring `hermes-studio-asset://` handles. Filesystem paths are never embedded in protocol URLs. |

The complete renderer contract and command-by-command migration ledger are in
[NATIVE_BRIDGE.md](./NATIVE_BRIDGE.md).

## BrowserWindow and origin policy

The window is frameless and uses `contextIsolation: true`, `sandbox: true`,
`webSecurity: true`, `nodeIntegration: false`, and
`allowRunningInsecureContent: false`. Production content is served by the
privileged `hermes-studio://app/` protocol rather than `file://`. Development
accepts only `http://127.0.0.1:1420` or `http://localhost:1420`; credentials,
other ports, paths, queries, and fragments are rejected. A packaged process
ignores `HERMES_STUDIO_DEV_SERVER` even when the parent environment contains it,
so a production executable cannot load the development renderer.

Navigation, redirects, new windows, and webview attachment are denied. Both
permission request and permission check handlers default-deny everything except
audio-only media requested by the trusted app main frame. Video is rejected.
Windows alone accepts Electron 40's absent, empty, or `unknown` media-detail
shapes after every other trust check passes; explicit video remains denied and
macOS/Linux fail closed. The macOS package declares
the microphone usage description plus explicit audio/JIT/native-library
entitlements.

App responses receive a strict CSP, `Referrer-Policy: no-referrer`, and
`X-Content-Type-Options: nosniff`. Production script policy is self-only.
Only renderer assets with recognized content-hash filenames receive immutable
one-year caching; HTML and stable-name assets use `no-cache`.
Development adds only the exact Vite HTTP/WebSocket origin and development-only
`unsafe-eval`. Backend connections add only the exact active loopback sidecar
origin. Object, base, ancestor, and form capabilities are disabled.

## Startup and recovery

1. Register privileged app and asset schemes before Electron is ready.
2. Select the Studio-specific Electron `userData` directory before claiming the
   single-instance lock. The packaged smoke harness may instead supply its own
   existing, canonical directory only when an internal test marker is present,
   the app is packaged, and the directory is a generated child of the OS temp
   root; normal development and production launches cannot override this path.
3. Claim the single-instance lock in that `userData` namespace; a second normal
   launch focuses the existing window while a packaged smoke run remains
   isolated from a user's running Studio instance.
4. Validate/prune the
   bounded persistent attachment staging inventory, and configure the default
   session's permissions and security headers.
5. Register protocols, native services, validated IPC handlers, and lifecycle
   event forwarding.
6. Create and show the window independently of backend readiness.
7. Start the sidecar asynchronously. Failure produces a typed lifecycle event
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

Renderer bootstrap subscribes to `backend.onReady` and
`backend.onRestarted`, refreshes the shared authenticated `HttpClient` cache,
and releases both subscriptions on retry or unmount. In Electron,
`backend.info()` is authoritative: discovery failure is surfaced and never
downgrades to a compiled URL/token. Only a bridge-absent, non-production Vite
renderer may use explicit `VITE_SIDECAR_URL` and `VITE_SIDECAR_TOKEN` values.
The production environment file contains neither value.

Sidecar stderr is appended to
`$HERMES_HOME/logs/hermes-studio.log` (default `~/.hermes`). Known generated
secrets, Authorization values, URL credentials, and common token/key/password
parameters are redacted before writing.

## Native service ownership

- Hermes Home reads, writes, and listings accept relative paths only, resolve
  symlinks, enforce containment, cap content, require UTF-8 text, and write
  atomically. Reads use a bounded descriptor loop through `maxBytes + 1`;
  listings stop `opendir()` iteration at `maxEntries + 1`; writes and listings
  compare canonical directory identity immediately around use. Node has no portable
  cross-platform `openat`, so this is a fail-closed race detector rather than
  an absolute same-user filesystem sandbox.
- Workspace selection uses Electron's native directory dialog. Main retains a
  private grant and sends the canonical cwd to the sidecar with both API and
  workspace-grant authentication; the grant never appears in bridge state.
- Attachment selection is limited to file/folder/image modes and returns typed
  `{kind,path,name}` records so a random staged path never replaces the source
  display name. Main owns the fixed image filter, canonicalizes file/folder
  results, and descriptor-copies external images into a session-specific root.
  OS drag/drop uses a separate high-level method: preload applies Electron 40
  `webUtils.getPathForFile` synchronously to at most 64 original `File` objects,
  and main repeats metadata/path validation before canonicalizing or staging.
  Raw `webUtils` and generic path resolution are not exposed.
- Image staging is serialized and has per-session and process-wide file/byte
  caps. A batch rolls back on any failure; any post-create write or rollback
  cleanup failure invalidates the in-memory inventory so disk is reconstructed
  before another admission. Valid staged images persist across clean shutdown/
  restart so localStorage composer drafts remain usable. Startup canonically
  scans a hard-bounded number of entries, reads at most 4 KiB of signature from
  each stable descriptor, and prunes illegal, expired, or over-quota crash
  remainders before rebuilding inventory. Scan overflow rotates through one
  known, startup-swept quarantine rather than creating unbounded siblings. A
  different session cannot persist a known staged path.
- One image-format table controls picker extensions, magic validation,
  persistence, and MIME responses for PNG, JPG/JPEG, GIF, WebP, BMP, TIFF/TIF,
  HEIC/HEIF, and ICO; ISO-BMFF `ftyp` inspection is capped at 4 KiB. Clipboard and persisted image services also cap size. Remote
  clipboard downloads resolve and pin public IP addresses, reject private or
  reserved networks, revalidate redirects, time out, and enforce byte limits.
- PTYs are keyed by random IDs, use bounded dimensions/input and direct
  byte-preserving `Buffer` writes, route data/exit/error events by ID, and are all stopped during
  shutdown. They are user-authorized arbitrary login shells, not sandboxes, and
  preserve the user's environment/API keys; only npm/color noise and private
  Studio/sidecar variables are removed. POSIX repairs node-pty `spawn-helper`
  execute bits best-effort before the first spawn.
- Window geometry is persisted only after validating that it remains visible on
  a current display. Window dragging uses trusted CSS `-webkit-app-region: drag`
  regions because Electron has no equivalent safe programmatic move API.
- Native notifications focus the existing window on interaction. Action buttons
  are enabled on macOS; other hosts show the notification without action buttons
  and report that actions are unsupported.

## Renderer interaction contracts

- Attachment pickers return typed `{kind,path,name}` values. The user-visible
  chip always uses `name`; it never derives a label by splitting an opaque or
  staged path. Mixed OS drops pass the original `File[]` to preload immediately
  and consume the canonical/staged records returned by main.
- Local images are rendered only after `assets.urlForPath()` resolves an opaque
  asset URL. Remote image copy accepts HTTP(S) URLs through
  `clipboard.copyRemoteImage()`; renderer code never treats a local path as a
  remote URL.
- Terminal sessions, workspace selection, notifications, external URLs,
  clipboard access, settings files, window controls, and macOS Command Line
  Tools installation all use named high-level bridge methods. Window dragging
  uses CSS `-webkit-app-region`; renderer code never calls `window.startDrag()`.
- All renderer-owned local storage lives under the centralized
  `hermes.studio.*` namespace. Previous host-era keys are intentionally neither
  read nor deleted, preventing cross-application state contamination.
- The first Electron release has no update-check setting, updater UI, or
  renderer updater call. Typography uses the bundled/system sans-serif stack;
  startup makes no Google Fonts request.

## Shutdown

Every `before-quit` event is prevented while one shared cleanup promise is in
progress. Cleanup first closes native IPC admission synchronously and drains
every already-admitted handler. Main then saves window state best-effort,
independently closes PTYs and notifications, revokes ephemeral opaque handles
and workspace grants, closes attachment staging without deleting valid draft
images or rescanning their contents, and awaits sidecar shutdown before one final allowed quit. Failure in one cleanup
step is reported but cannot skip later steps. Sidecar shutdown wakes any
pending restart backoff, waits for in-flight cleanup, and targets only the child
created by this manager: its detached process group on POSIX or the owned PID's
tree on Windows. No process-name-wide kill is used.

## Packaging boundary

PyInstaller builds only for the runner's native OS and architecture. The build
entry stages exactly one executable at `sidecar/dist/electron/daemon[.exe]`;
the staging directory is cleared first so output from another host cannot leak
into the package. electron-builder copies it to packaged
`resources/sidecar`. `node-pty` native files are unpacked from ASAR and its
POSIX helper is repaired in the writable `app.asar.unpacked` tree when needed.
Windows sets the package app id early for toast identity. macOS enables hardened
runtime and uses Studio-owned main/inherit entitlements for microphone and
Electron native runtime requirements.
Cross-compiling a PyInstaller binary is unsupported; CI uses native macOS,
Windows, and Linux runners.
