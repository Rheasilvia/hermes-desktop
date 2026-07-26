# Hermes Studio Native Bridge

This document is the frozen Task 3 contract for the Electron native host.
`src/shared/native-bridge.ts` is the source of truth for types and channel
names. Preload installs one deeply frozen `window.hermesStudio` object and
unwraps main-process result envelopes. Task 4 migrates renderer call sites to
this already implemented API.

## Renderer API

```ts
window.hermesStudio = {
  app: { version, platform, nativeState },
  backend: { info, restart, onReady, onUnhealthy, onRestarted, onFailed },
  hermesHome: { path, readText, writeText, list },
  workspace: { selectForSession },
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

Main handlers always return one of:

```ts
{ ok: true, value: T }
{ ok: false, error: { code: string, message: string } }
```

Preload converts the second form into `HermesStudioNativeError`, preserving
only the stable `code` and safe `message`. Native stack traces and secrets are
not sent to the renderer.

## Capability ledger

The registered Tauri command list was frozen before implementation. The table
records every legacy entry and its Electron disposition. “Packaged acceptance”
is the native-runner check required before Task 3 can be treated as release
ready; unit tests exercise the same contract without needing a packaged app.

| Legacy registered entry | Electron renderer API | Main validation/ownership | Automated evidence | Packaged acceptance |
| --- | --- | --- | --- | --- |
| `get_app_version` | `app.version()` | Electron app metadata; trusted sender | bridge routing + envelope | Value matches packaged app version |
| `get_platform` | `app.platform()` | Normalized `macos/windows/linux` | bridge routing | Matches native runner |
| `get_hermes_home` | `hermesHome.path()` | Resolved Hermes Home owned by main | Hermes Home + bridge tests | Shows the active profile home |
| `read_file` | `hermesHome.readText(path)` | Relative-only, canonical containment, UTF-8, size cap | traversal, symlink, encoding, size tests | Read a small profile file; escape is rejected |
| `write_file` | `hermesHome.writeText(path, content)` | Same containment; bounded atomic write | containment + atomic write tests | Write/re-read a temporary profile file |
| `list_dir` | `hermesHome.list(path)` | Same containment; bounded sorted listing | containment + list-limit tests | List a profile subdirectory |
| `open_external` | `system.openExternal(url)` | Credential-free HTTPS; HTTP only on localhost/loopback | URL policy tests | Open an HTTPS link; reject `file:` |
| `install_macos_command_line_tools` | `system.installMacosCommandLineTools()` | Exact `/usr/bin/xcode-select --install`; macOS only | service behavior tests | macOS opens installer; other hosts return stable error |
| `read_clipboard_image` | `clipboard.readImage()` | Native image validation; copy into managed root; opaque URL | service + asset tests | Paste PNG from OS clipboard |
| `write_clipboard_image_from_url` | `clipboard.copyRemoteImage(url)` | Public HTTP(S) only, DNS/IP pinning, redirect revalidation, timeout, MIME/size caps | SSRF, redirect, MIME, size tests | Copy a public image; reject loopback URL |
| `persist_session_image` | `assets.persistSessionImage(sessionId, sourcePath)` | Valid session ID, permitted source root, image/size cap, random destination | asset store tests | Persist selected/clipboard image and reload opaque URL |
| `select_workspace_for_session` | `workspace.selectForSession(sessionId)` | Native directory dialog; canonical grant private to main; authenticated sidecar PATCH | grant privacy/auth tests | Select a folder and verify session cwd changes |
| `terminal_start` | `terminal.start(options)` | Existing cwd, bounded dimensions, scrubbed env, random terminal ID | PTY routing tests | Start shell in chosen cwd |
| `terminal_write` | `terminal.write(id, bytes)` | Known terminal ID; validated bytes and 1 MiB input cap | PTY validation/routing tests | Type and receive output |
| `terminal_resize` | `terminal.resize(id, cols, rows)` | Known ID; bounded dimensions | PTY validation/routing tests | Resize without losing session |
| `terminal_stop` | `terminal.stop(id)` | Known ID; idempotent cleanup | exit/stop/shutdown tests | Close terminal and confirm exit event |
| `sidecar_info` | `backend.info()` | Main returns only active base URL/API token; private grant excluded | bridge + grant privacy tests | Renderer can reach loopback health/API |
| `check_for_updates` | retired | No updater IPC or package integration in first Electron release | explicit bridge-surface exclusion test | Confirm no update UI/API is advertised |
| `install_update` | retired | No updater IPC or package integration in first Electron release | explicit bridge-surface exclusion test | Confirm no update installation path exists |

Legacy Tauri plugins are represented as follows:

| Legacy plugin surface | Electron bridge/host behavior |
| --- | --- |
| dialog | `workspace.selectForSession()` owns the only required native directory picker |
| clipboard manager | `clipboard.readImage()` and `clipboard.copyRemoteImage()` |
| notification | `notifications.show/onClick/onAction` |
| window/window-state | `window.*`, focus/state events, persisted visible bounds, single-instance focus |
| updater | intentionally retired |

Rust functions that existed in source but were not in `invoke_handler!` remain
unexposed. In particular, there are no Electron bridge channels for git
operations, workspace browsing/tree/reveal, arbitrary process spawning, or a
renderer-controlled workspace grant.

## Request validation

- The IPC event must come from the current main window's `webContents` and an
  exact trusted app URL.
- Handlers parse one object payload or require no payload. Unknown/malformed
  values fail before service code runs.
- Strings, session IDs, terminal IDs, dimensions, byte arrays, notification
  fields, paths, and URLs have explicit type and length/range rules.
- Hermes Home access takes relative paths only. Canonical root and target paths
  are compared after symlink resolution; writes validate the canonical parent.
- Workspace and asset access is capability based: roots are granted in main;
  asset URLs contain a 256-bit random expiring handle instead of a file path.
- Remote image fetches reject URL credentials and non-HTTP(S) schemes, resolve
  every hostname, reject any private/link-local/reserved/documentation/mapped
  address, pin a selected public IP, preserve Host/SNI, manually revalidate
  redirects, and cap time and bytes.
- PTY operations address only processes created by `TerminalManager`; renderer
  input cannot name an executable or supply an arbitrary environment.
- External URL opening preserves the legacy HTTPS/localhost-only policy.

## Host policy and lifecycle events

Production renderer content is `hermes-studio://app/`; local files are never
loaded with `file://`. The only permitted development origins are the exact
Vite origins on port 1420. Navigation, redirects, popups, webviews, and all
permissions except trusted-origin audio are denied. CSP, referrer, and MIME
headers are installed both on app responses and the session.

The bridge emits:

- backend `ready`, `unhealthy`, `restarted`, and `failed`;
- terminal `data`, `exit`, and `error`, all keyed by terminal ID;
- window focus and state changes;
- notification click and action events.

The backend binds a new random loopback port after a restart. Main delivers the
lifecycle event and then reloads the renderer so the new document CSP can name
that exact origin; renderer startup re-subscribes and calls `backend.info()`.

Notification action buttons are a macOS capability in Electron. Other hosts
still display the notification and return `actionsSupported: false`.
Programmatic window movement is deliberately not emulated: `window.startDrag()`
returns `WINDOW_DRAG_REGION_REQUIRED`; Task 4 uses a trusted CSS
`-webkit-app-region: drag` title-bar region.

## Verification

Run from `apps/hermes-studio`:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The Electron Vitest suites cover trusted sender/origin checks, IPC schemas and
stable envelopes, bridge freezing/unsubscribe behavior, Hermes Home traversal
and symlink containment, asset-handle forgery/expiry/protocol responses, remote
image SSRF/redirect/content/size policy, PTY routing and shutdown, permission
and navigation denial, CSP/referrer policy, window state and single-instance
focus, workspace grant privacy/authentication, notifications, sidecar recovery,
and explicit non-exposure of retired/unregistered capabilities.

Before release, perform the packaged acceptance item in every capability-ledger
row on a signed native macOS, Windows, and Linux runner as applicable. Also
verify that DevTools cannot access `require`, `process`, raw `ipcRenderer`, the
workspace-grant token, or turn forged/expired asset handles into file access.
