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
| `read_file` | `hermesHome.readText(path)` | Relative-only, canonical containment, UTF-8, descriptor read capped at `maxBytes + 1` | traversal, symlink, encoding, growth/size tests | Read a small profile file; escape is rejected |
| `write_file` | `hermesHome.writeText(path, content)` | Same containment; bounded atomic write | containment + atomic write tests | Write/re-read a temporary profile file |
| `list_dir` | `hermesHome.list(path)` | Same containment; `opendir()` stops at `maxEntries + 1`; sorted result | containment + growth/list-limit tests | List a profile subdirectory |
| `open_external` | `system.openExternal(url)` | Credential-free HTTPS; HTTP only on localhost/loopback | URL policy tests | Open an HTTPS link; reject `file:` |
| `install_macos_command_line_tools` | `system.installMacosCommandLineTools()` | Exact `/usr/bin/xcode-select --install`; macOS only | service behavior tests | macOS opens installer; other hosts return stable error |
| `read_clipboard_image` | `clipboard.readImage()` | Native image validation; copy into managed root; opaque URL | service + asset tests | Paste PNG from OS clipboard |
| `write_clipboard_image_from_url` | `clipboard.copyRemoteImage(url)` | Public HTTP(S) only, DNS/IP pinning, redirect revalidation, timeout, MIME/size caps | SSRF, redirect, MIME, size tests | Copy a public image; reject loopback URL |
| `persist_session_image` | `assets.persistSessionImage(sessionId, sourcePath)` | Valid session ID, permitted source root, image/size cap, random destination | asset store tests | Persist selected/clipboard image and reload opaque URL |
| `select_workspace_for_session` | `workspace.selectForSession(sessionId)` | Native directory dialog; canonical grant private to main; authenticated sidecar PATCH | grant privacy/auth tests | Select a folder and verify session cwd changes |
| MessageInput dialog migration (no registered Rust command) | `workspace.selectAttachments({sessionId, kind, multiple})` | Fixed file/folder/image modes; canonical `{kind,path,name}` results preserve display names; central image filter; bounded persistent per-session staging; cancellation returns `[]` | picker/filter/name/cancellation/session-isolation/restart tests | Select one/many files and folders; select/persist an external image; restore an unsent image draft after restart |
| MessageInput OS drag/drop migration (no registered Rust command) | `workspace.importDroppedFiles(sessionId, files)` | Preload synchronously resolves original `File` objects with `webUtils.getPathForFile`; 1-64 bounded metadata records; main revalidates and returns canonical `{kind,path,name}` results; images use the same staging/magic policy | preload extraction/surface, payload, mixed-drop, spoof, staging tests | Drop mixed files/images and restore their original display names; synthetic files are rejected |
| `terminal_start` | `terminal.start(options)` | Existing cwd, bounded dimensions, user environment minus Studio secrets/noise, random terminal ID | PTY routing/env/helper tests | Start shell in chosen cwd |
| `terminal_write` | `terminal.write(id, bytes)` | Known terminal ID; validated bytes and 1 MiB input cap; direct byte-preserving `Buffer` write | PTY split/invalid/control-byte tests | Type and receive output |
| `terminal_resize` | `terminal.resize(id, cols, rows)` | Known ID; bounded dimensions | PTY validation/routing tests | Resize without losing session |
| `terminal_stop` | `terminal.stop(id)` | Known ID; idempotent cleanup | exit/stop/shutdown tests | Close terminal and confirm exit event |
| `sidecar_info` | `backend.info()` | Main returns only active base URL/API token; private grant excluded | bridge + grant privacy tests | Renderer can reach loopback health/API |
| `check_for_updates` | retired | No updater IPC or package integration in first Electron release | explicit bridge-surface exclusion test | Confirm no update UI/API is advertised |
| `install_update` | retired | No updater IPC or package integration in first Electron release | explicit bridge-surface exclusion test | Confirm no update installation path exists |

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
