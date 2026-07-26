# Hermes Studio Native Bridge

This document is the frozen Electron native-host contract.
`src/shared/native-bridge.ts` is the source of truth for types and channel
names. Preload installs one deeply frozen `window.hermesStudio` object and
unwraps main-process result envelopes. Production renderer call sites consume
this API through `src/services/native-host.ts`; browser tests may inject the
same typed surface without adding a generic IPC escape hatch.

## Renderer API

```ts
window.hermesStudio = {
  app: { version, platform, nativeState },
  backend: { info, restart, onReady, onUnhealthy, onRestarted, onFailed },
  hermesHome: { path, readText, writeText, list },
  workspace: { selectForSession, selectAttachments, importDroppedFiles },
  clipboard: { readImage, copyRemoteImage },
  assets: { persistSessionImage, urlForPath },
  terminal: { start, write, resize, stop, onData, onExit, onError },
  window: {
    minimize, toggleMaximize, close, startDrag, focus, state,
    onFocus, onState,
  },
  system: { openExternal, installMacosCommandLineTools },
  notifications: { show, onClick, onAction },
}
```

Every method returns a promise. Every `on...` method returns an idempotent
unsubscribe function. Event payloads and the public object graph are frozen.
There is no generic invoke, subscribe, shell, filesystem, process, or raw IPC
escape hatch.

Bridge presence is authoritative. In Electron, backend discovery, native
settings, OS integrations, and lifecycle events either succeed through this
object or surface a controlled failure; renderer code never falls back to
retired native-host APIs. A bridge-absent Vite renderer may use explicit
development-only backend configuration and otherwise keeps native features
inert.

Main handlers always return one of:

```ts
{ ok: true, value: T }
{ ok: false, error: { code: string, message: string } }
```

Preload rejects the call with a cloneable `{ code, message }` object.
This is deliberate: Electron drops custom properties from `Error` values when
they cross an isolated `contextBridge`, while plain data preserves both stable
fields. Promise-rejection cloning does not preserve an object's frozen state,
so consumers treat the shape as immutable data rather than relying on
`Object.isFrozen`. Native stack traces and secrets are not sent to the renderer.

## Capability ledger

This ledger is keyed by the public `HermesStudioBridge` interface, not by a
frozen method count. The documentation checker derives every public method and
event subscription from `src/shared/native-bridge.ts` and requires one complete
row. Each row records renderer-boundary validation, automated evidence, and a
concrete packaged-app acceptance. The legacy column explains provenance only;
it is not an active API.

| Public bridge API/event | Legacy origin | Main validation/ownership | Unit/automated evidence | Packaged acceptance |
| --- | --- | --- | --- | --- |
| `app.version()` | `get_app_version` | Trusted main-frame sender; value comes from Electron app metadata. | `native-bridge-main.test.ts` checks routing and result envelopes. | Version equals the installed package metadata. |
| `app.platform()` | `get_platform` | Trusted sender; main normalizes to `macos`, `windows`, or `linux`. | `native-bridge-main.test.ts` covers the normalized result. | Value matches the native runner OS. |
| `app.nativeState()` | Electron addition | Trusted sender; main reads packaged, focused, and maximized state. | Bridge and window-state tests cover the object and envelope. | Reports `isPackaged: true` and current focus/maximize state. |
| `backend.info()` | `sidecar_info` | Trusted sender; main returns only the current loopback URL and ephemeral API token, never the workspace grant. | `native-bridge-main.test.ts` and `sidecar-manager.test.ts` cover routing and credential ownership. | Renderer reaches authenticated sidecar health using returned data. |
| `backend.restart()` | Electron lifecycle addition | Trusted sender; main serializes bounded child stop/start. The same manager-owned API token and hidden workspace grant remain unchanged; only the child process, random port, and returned `SidecarInfo` update. | `sidecar-manager.test.ts` covers child/port replacement, retry caps, token injection, and grant non-exposure. | Child and port change, `SidecarInfo.token` remains byte-identical, and workspace selection still works with the same hidden grant. |
| `backend.onReady()` | Electron lifecycle event | Preload accepts only the named main event, freezes `SidecarInfo`, and returns idempotent unsubscribe. | `preload-bridge.test.ts` checks event filtering, freezing, and unsubscribe. | First packaged sidecar readiness reaches the renderer exactly once. |
| `backend.onUnhealthy()` | Electron lifecycle event | Main emits a safe reason only; preload freezes the payload and exposes no process handle. | `preload-bridge.test.ts` and `sidecar-manager.test.ts` cover event shape and health failure. | Stopping/failing health produces the controlled unhealthy state. |
| `backend.onRestarted()` | Electron lifecycle event | Main publishes the updated `SidecarInfo` with the new port and same API token; the same hidden workspace grant remains main-only. Preload restricts the listener to its channel. | Preload and sidecar-manager restart tests cover updated `SidecarInfo`, listener cleanup, and grant non-exposure. | Reconnect REST/SSE to the new port with the same token, then confirm workspace selection still uses the unchanged hidden grant. |
| `backend.onFailed()` | Electron lifecycle event | Main maps startup failure to stable `NativeError`; stacks and secrets are removed. | Preload and native-error tests cover safe failure payloads. | Forced startup failure shows a controlled error without exposing the token. |
| `hermesHome.path()` | `get_hermes_home` | Trusted sender; main resolves the active profile-aware Hermes Home. | `hermes-home.test.ts` and bridge routing tests cover resolution. | Path reflects the selected Hermes profile home. |
| `hermesHome.readText()` | `read_file` | Relative path only; canonical containment, no-follow descriptor checks, UTF-8, identity revalidation, and byte cap. | `hermes-home.test.ts` covers traversal, symlink, encoding, growth, and size cases. | Read a small profile file; traversal and symlink escape are rejected. |
| `hermesHome.writeText()` | `write_file` | Relative path only; bounded content, canonical containment, exclusive temporary file, atomic rename, and directory revalidation. | `hermes-home.test.ts` covers containment and atomic-write failure cleanup. | Write and re-read a temporary profile file without partial output. |
| `hermesHome.list()` | `list_dir` | Relative path only; canonical directory containment, identity checks, bounded `opendir()` iteration, sorted result. | `hermes-home.test.ts` covers symlink and entry-growth/list-limit cases. | List a profile subdirectory; over-limit and escape requests fail. |
| `workspace.selectForSession()` | `select_workspace_for_session` | Valid session ID; main owns native directory dialog, canonical workspace grant, and authenticated sidecar PATCH. | `native-services.test.ts` and workspace-grant tests cover grant privacy/authentication. | Select a folder and verify the session cwd changes. |
| `workspace.selectAttachments()` | Former dialog plugin | Fixed file/folder/image modes; valid session ID; central filters; canonical results; bounded per-session image staging; cancel returns `[]`. | `attachment-picker.test.ts` covers modes, filters, names, cancellation, quotas, and restart. | Select files/folders/images and restore an unsent staged image after restart. |
| `workspace.importDroppedFiles()` | Former OS drag/drop plugin | Preload accepts original `File` objects only, resolves with `webUtils.getPathForFile`, caps 1–64 records; main revalidates paths/metadata and stages images. | `preload-bridge.test.ts` and `attachment-picker.test.ts` cover synthetic/spoofed and mixed drops. | Drop mixed files/images, preserve display names, and reject synthetic files. |
| `clipboard.readImage()` | `read_clipboard_image` | Main reads native clipboard image, verifies bytes/format/size, stages it, and returns an opaque asset URL. | `native-services.test.ts` and `assets.test.ts` cover empty/invalid/valid images. | Paste a PNG from the OS clipboard and render it from the opaque URL. |
| `clipboard.copyRemoteImage()` | `write_clipboard_image_from_url` | Public HTTP(S) only; DNS/IP pinning, redirect revalidation, timeout, MIME/magic, and size caps. | `native-services.test.ts` covers SSRF, redirect, MIME, timeout, and size policy. | Copy a public image; loopback, private-IP, and `file:` URLs fail. |
| `assets.persistSessionImage()` | `persist_session_image` | Valid session ID; allowed source roots; canonical source; image magic/size cap; random managed destination. | `assets.test.ts` and attachment tests cover source policy, format, quotas, and persistence. | Persist a selected image and reload it after renderer restart. |
| `assets.urlForPath()` | Electron opaque-asset addition | Canonical permitted asset path; main issues a random expiring handle instead of disclosing a file URL. | `assets.test.ts` covers handle expiry, capacity, containment, and MIME. | Render an approved asset URL; expired or unregistered paths fail. |
| `terminal.start()` | `terminal_start` | Existing canonical cwd, bounded dimensions, sanitized environment, approved shell, random terminal ID. | `terminal-manager.test.ts` covers cwd, dimensions, environment, shell, and spawn-helper checks. | Start a PTY in the chosen cwd and observe its prompt. |
| `terminal.write()` | `terminal_write` | Known terminal ID; numeric byte array, per-write size cap, and byte-preserving buffer write. | `terminal-manager.test.ts` covers invalid IDs/bytes, split input, control bytes, and caps. | Type a sentinel and receive exact terminal output. |
| `terminal.resize()` | `terminal_resize` | Known terminal ID and bounded integer columns/rows. | `terminal-manager.test.ts` covers invalid bounds and PTY routing. | Resize repeatedly without terminating or corrupting the shell. |
| `terminal.stop()` | `terminal_stop` | Known terminal ID; stop and cleanup are idempotent. | `terminal-manager.test.ts` and shutdown tests cover stop, exit, and cleanup. | Close the terminal and receive one final exit event. |
| `terminal.onData()` | Former terminal event | Main publishes bytes for a known PTY; preload freezes `{id,data}` and provides idempotent unsubscribe. | `preload-bridge.test.ts` and `terminal-manager.test.ts` cover event routing and byte fidelity. | Packaged PTY output reaches only its owning terminal view. |
| `terminal.onExit()` | Former terminal event | Main emits normalized exit code/signal once and removes the PTY record. | Terminal-manager and preload tests cover exit normalization and unsubscribe. | Natural exit and explicit stop each produce the expected exit event. |
| `terminal.onError()` | Electron terminal event | Main reduces PTY failures to `{id,error}`; preload freezes the safe payload. | Terminal-manager and preload tests cover spawn/runtime errors. | Invalid packaged shell startup shows a controlled terminal error. |
| `window.minimize()` | Former window plugin | Trusted current main-frame sender; operation targets only the owned main window. | `native-bridge-main.test.ts` verifies sender admission and routing. | Custom titlebar minimizes the packaged window. |
| `window.toggleMaximize()` | Former window plugin | Trusted sender; main toggles only the owned window and emits normalized state. | Bridge and `window-state.test.ts` cover toggling/state persistence. | Custom titlebar maximizes and restores on each native OS. |
| `window.close()` | Former window plugin | Trusted sender; close enters the coordinated shutdown path. | Bridge and shutdown tests cover routing and cleanup ordering. | Close exits cleanly and stops sidecar/PTYs. |
| `window.startDrag()` | Former window plugin | Trusted sender, but main performs no programmatic drag and always returns `WINDOW_DRAG_REGION_REQUIRED`. | `native-bridge-main.test.ts` asserts the stable rejection; `NativeDragRegions.test.ts` and `TitleBar.test.tsx` prove CSS regions are present and renderer interaction never calls the API. | Drag the packaged window through CSS `-webkit-app-region: drag`; a direct API call is stably rejected with `WINDOW_DRAG_REGION_REQUIRED`. |
| `window.focus()` | Electron single-instance addition | Trusted sender; main restores a minimized window and focuses it. | `window-state.test.ts` covers restore/focus behavior. | Activation or a second launch focuses the existing instance. |
| `window.state()` | Former window-state plugin | Trusted sender; main returns only normalized focus/maximized/minimized booleans. | Bridge and window-state tests cover the state object. | State matches native minimize/maximize/focus changes. |
| `window.onFocus()` | Former window-state event | Main emits a boolean for the owned window; preload restricts channel and unsubscribe. | `preload-bridge.test.ts` covers frozen listener surface and removal. | Focus and blur update renderer state without duplicate listeners. |
| `window.onState()` | Former window-state event | Main emits frozen normalized state after native window transitions. | Preload and window-state tests cover routing and persisted visible bounds. | Minimize/maximize/restore events stay synchronized with the titlebar. |
| `system.openExternal()` | `open_external` | Credential-free HTTPS only, plus HTTP on exact loopback hosts; all other schemes/credentials rejected. | `native-services.test.ts` covers URL and credential policy. | Open an HTTPS link; reject `file:`, credentialed, and private-host URLs. |
| `system.installMacosCommandLineTools()` | `install_macos_command_line_tools` | macOS only; exact `/usr/bin/xcode-select --install`, no renderer-controlled command/arguments. | `native-services.test.ts` covers platform gate and fixed invocation. | macOS opens the installer; other hosts return a stable unsupported error. |
| `notifications.show()` | Former notification plugin | Bounded title/body/actions/context; main owns native notification IDs and capability detection. | `notification-manager.test.ts` and bridge tests cover validation and native behavior. | Show a notification with the correct action capability result. |
| `notifications.onClick()` | Former notification event | Main returns only frozen notification ID/context; listener is channel-scoped and removable. | `notification-manager.test.ts` and `preload-bridge.test.ts` cover click routing/unsubscribe. | Clicking focuses Studio and routes the saved context once. |
| `notifications.onAction()` | Former notification action event | Main allowlists the action ID from the notification and freezes ID/context payload. | Notification-manager and preload tests cover action matching and cleanup. | Supported native action focuses Studio and dispatches the intended action. |

The former `check_for_updates` and `install_update` commands are deliberately
retired. Version 1 has no updater bridge, UI, or package integration; surface
exclusion tests and the packaged acceptance checklist confirm that no update
path is advertised.

Legacy Tauri plugins are represented as follows:

| Legacy plugin surface | Electron bridge/host behavior |
| --- | --- |
| dialog | `workspace.selectForSession()` owns cwd selection; `workspace.selectAttachments({sessionId, kind, multiple})` owns the file/folder/image picker. Image filters are fixed by main, cancellation returns `[]`, and typed results carry the source display name separately from a staged image path. |
| OS drag/drop | `workspace.importDroppedFiles(sessionId, files)` is the only path bridge. Preload uses Electron 40 `webUtils.getPathForFile` internally on original `File` objects; raw `webUtils` and a generic path resolver are not exposed. Main canonicalizes ordinary files and stages images. |
| clipboard manager | `clipboard.readImage()` and `clipboard.copyRemoteImage()` |
| notification | `notifications.show/onClick/onAction` |
| window/window-state | `window.*`, focus/state events, persisted visible bounds, single-instance focus |
| updater | intentionally retired |

Rust functions that existed in source but were not in `invoke_handler!` remain
unexposed. In particular, there are no Electron bridge channels for git
operations, workspace browsing/tree/reveal, arbitrary process spawning, or a
renderer-controlled workspace grant.

## Request validation

- The IPC event must come from the current main window's `webContents`, its
  exact `mainFrame` object (same-origin subframes are rejected), and an exact
  trusted app URL.
- Handlers parse one object payload or require no payload. Unknown/malformed
  values fail before service code runs.
- Native IPC admission closes synchronously when shutdown starts. Trusted calls
  already admitted are counted and drained before any owned resource is swept;
  later calls return `IPC_SHUTTING_DOWN` without parsing or running service code.
- Strings, session IDs, terminal IDs, dimensions, byte arrays, notification
  fields, paths, and URLs have explicit type and length/range rules.
- Hermes Home access takes relative paths only. Reads and image copies use
  `O_NOFOLLOW` where available, descriptor `fstat`, descriptor reads, canonical
  containment, and `dev`/`ino` identity checks. Exclusive temporary writes
  revalidate the destination directory immediately before and after rename.
  Directory listings iterate `opendir()` only through `maxEntries + 1` and
  revalidate identity immediately before and after iteration.
- Workspace and asset access is capability based: workspace roots and image
  staging roots are scoped to the requesting session. Asset URLs contain a
  256-bit random expiring handle instead of a file path; expired handles are
  swept opportunistically and the registry has a hard capacity limit.
- One canonical image-format table drives picker extensions, signature checks,
  persistence allowlists, and response MIME types. It includes PNG, JPG/JPEG,
  GIF, WebP, BMP, TIFF/TIF (`II` and `MM`), HEIC/HEIF (`ftyp` brands), and ICO;
  a claimed extension must agree with file magic and ISO-BMFF brand inspection
  never exceeds the first 4 KiB.
- Persistent image staging serializes admissions under per-session and global
  file/byte caps. Startup examines a hard-bounded entry count and only 4 KiB of
  each stable candidate descriptor, rebuilds quota inventory, and prunes stale,
  malformed, or over-quota files. Entry overflow recovers through one known
  startup-swept quarantine. Any write/rollback cleanup uncertainty invalidates
  inventory before the next admission; clean shutdown only closes and drains
  staging, preserving draft paths without rereading their contents.
- Drop import accepts at most 64 original OS-backed `File` objects. Preload
  validates bounded name/type/size metadata before path extraction; main
  repeats validation and ignores renderer MIME/name claims for classification
  and canonical output names.
- Remote image fetches reject URL credentials and non-HTTP(S) schemes, resolve
  every hostname, reject all answers in the IANA IPv4/IPv6 special-purpose
  ranges (including transition and embedded-address forms), default-deny IPv6
  outside allocated `2000::/3`, pin a selected public IP, preserve Host/SNI,
  manually revalidate redirects, and cap time and bytes. The address policy is
  checked against the [IANA IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry/)
  and [IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry/).
- PTY operations address only processes created by `TerminalManager`; renderer
  input cannot name an executable or supply a replacement environment. A PTY
  is nevertheless an explicit, user-authorized arbitrary login shell, not a
  security sandbox. It intentionally inherits the user's environment,
  including user-configured API keys. Main removes only npm/color noise and
  Studio/sidecar internal URLs, bearer tokens, and workspace-grant variables.
  Byte-array input is written as a `Buffer`, preserving split UTF-8, invalid
  bytes, NUL, and terminal control sequences without replacement.
- External URL opening preserves the legacy HTTPS/localhost-only policy.

## Host policy and lifecycle events

Production renderer content is `hermes-studio://app/`; local files are never
loaded with `file://`. The only permitted development origins are the exact
Vite origins on port 1420. Navigation, redirects, popups, webviews, and all
permissions except trusted-main-frame audio are denied. Video is always
rejected. Electron 40 permission callbacks whose media metadata is absent,
empty, or explicitly `unknown` are accepted only on Windows after webContents,
main-frame, origin, and `media` checks succeed; macOS and Linux fail closed.
CSP, referrer, and MIME headers
are installed both on app responses and the session.

The macOS package owns explicit main/inherit entitlement files for audio input
and Electron's JIT/native-library requirements. Windows sets
`com.hermes-agent.studio` as its AppUserModelID before notifications are used.
On POSIX, main performs a best-effort executable-bit repair of node-pty's
`spawn-helper` before the first spawn, including `app.asar.unpacked` paths.

### Filesystem race boundary

Node does not expose one portable `openat`/directory-fd-relative API across all
three supported hosts. Studio therefore binds reads and copies to verified
descriptors and makes writes fail closed when immediate canonical and
`dev`/`ino` revalidation observes a swap. Path-based directory listing and the
small gap around an atomic rename cannot be described as an absolute defense
against a concurrent same-user process. Consumers of returned file/folder
picker paths must re-authorize and revalidate them at the point of use.

The bridge emits:

- backend `ready`, `unhealthy`, `restarted`, and `failed`;
- terminal `data`, `exit`, and `error`, all keyed by terminal ID;
- window focus and state changes;
- notification click and action events.

The API token and hidden workspace grant are created once for the main-process
`SidecarManager` lifetime and do not rotate during a backend restart. Restart
replaces the child process, binds a new random loopback port, and updates
`SidecarInfo`; main delivers the lifecycle event and then reloads the renderer
so the new document CSP can name that exact origin. Renderer startup
re-subscribes and calls `backend.info()` with the unchanged token.

Notification action buttons are a macOS capability in Electron. Other hosts
still display the notification and return `actionsSupported: false`.
Programmatic window movement is deliberately not emulated: `window.startDrag()`
returns `WINDOW_DRAG_REGION_REQUIRED`; the renderer uses a trusted CSS
`-webkit-app-region: drag` title-bar region.

## Verification

Run from `apps/hermes-studio`:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

### Retired-surface search

```bash
rg -n "@tauri-apps|data-tauri|isTauri|Tauri|tauri:" src \
  --glob '*.{ts,tsx}' --glob '!**/*.test.*' --glob '!**/__tests__/**'
rg -n "\.startDrag\(" src \
  --glob '*.{ts,tsx}' --glob '!**/*.test.*' --glob '!**/__tests__/**'
```

The final search must report no production renderer dependency on Tauri and no
programmatic drag call. Historical strings may remain only in the scoped
capability ledger/search explanation and explicit legacy-isolation tests.

### Automated and packaged evidence

The Electron Vitest suites cover exact main-frame sender/origin checks, IPC
schemas, shutdown admission/draining, and stable envelopes; bridge
freezing/unsubscribe/drop behavior; Hermes Home traversal, bounded growth, and
deterministic path swaps; attachment filters/names/cancellation/session
isolation/restart persistence, transaction rollback, concurrent staging caps,
canonical image formats, and mixed/spoofed drops; asset-handle
forgery/expiry/sweep/cap/protocol responses; remote image
special-range/redirect/content/size policy; PTY helper/env/raw-byte/early-exit/shutdown; permission
and navigation denial, CSP/referrer policy, window state and single-instance
focus, repeated-quit cleanup and failure isolation, workspace grant
privacy/authentication/lifetime, notifications, sidecar recovery, macOS
entitlement references, and explicit non-exposure of retired/unregistered capabilities.

Before release, perform the packaged acceptance item in every capability-ledger
row on a signed native macOS, Windows, and Linux runner as applicable. Also
verify that DevTools cannot access `require`, `process`, raw `ipcRenderer`, the
workspace-grant token, or turn forged/expired asset handles into file access.
