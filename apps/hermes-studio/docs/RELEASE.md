# Hermes Studio release process

Hermes Studio packages Electron 40.10.2, a target-native `node-pty`, and a
host-native PyInstaller sidecar. Build each target on its own operating system
and CPU architecture. The package hook fails closed for cross-platform,
cross-architecture, and macOS universal builds because the Python sidecar
cannot be cross-compiled safely.

## Quality gate

Run from `apps/hermes-studio`:

```bash
npm run check
```

`check` runs both TypeScript projects, ESLint, Vitest, the packaging-script
tests, and the canonical documentation checker. The sidecar suite is separate:

```bash
cd sidecar
uv sync --frozen --extra dev
uv run --frozen --extra dev python -m pytest -q
```

## Native CI workflow

The reusable
[`.github/workflows/studio-native.yml`](../../../.github/workflows/studio-native.yml)
workflow is invoked by the root CI workflow when Studio-native inputs change.
It is also part of the required-jobs aggregation; a skipped matrix is distinct
from a failed one. The native matrix builds on the exact target it ships:

| Target | GitHub runner | Expected architecture | Installer output |
| --- | --- | --- | --- |
| macOS arm64 | `macos-15` | `arm64` | DMG |
| macOS x64 | `macos-15-intel` | `x64` | DMG |
| Windows x64 | `windows-2025` | `x64` | NSIS `.exe` |
| Linux x64 | `ubuntu-24.04` | `x64` | AppImage, deb, rpm, plus a mode-preserving tar |

Every matrix job verifies the Node runner architecture, installs the frozen
Node/Python environments, runs ESLint, CSS-token validation, both TypeScript
projects, Vitest/packaging tests, the sidecar boundary check and pytest suite,
builds Studio, runs `npm run test:packaged` (under Xvfb on Linux), builds the
host installer, and checks exact artifact names. The uploaded
`hermes-studio-unsigned-{platform}-{arch}-{sha}` artifacts are unsigned internal
test outputs retained for seven days, not distributable releases. Signing and
publication require a separately trusted release workflow and the credentials
below.

## Native build and package

The common current-host flow is:

```bash
npm run backend:build
npm run build
npm run pack
```

`backend:build` runs PyInstaller, stages exactly one executable at
`sidecar/dist/electron/daemon` (`daemon.exe` on Windows), preserves POSIX
execute bits, and verifies the real frozen executable's `READY <port>` stdout
protocol plus authenticated loopback health. The Windows executable retains a
console subsystem so stdout remains pipeable; Electron launches it with
`windowsHide: true`, so no console window is shown.

`build` bundles the renderer/main/preload and stages only the matching
`node-pty` runtime into `dist/node_modules/node-pty`. A matching prebuild is
used when available; otherwise `@electron/rebuild` rebuilds the exact host
architecture for Electron 40.10.2. The target-aware `beforePack` hook repeats
the staging for electron-builder's actual platform/architecture and rejects a
host mismatch. Packaged native files live under
`resources/app.asar.unpacked/dist/node_modules/node-pty`; POSIX
`spawn-helper` files must remain executable.

Use the platform-specific distribution commands on matching runners:

```bash
npm run dist:mac    # DMG
npm run dist:win    # NSIS
npm run dist:linux  # AppImage, deb, rpm
```

Artifacts use the exact name:

```text
Hermes-Studio-${version}-${os}-${arch}.${ext}
```

Application icons are owned by `build/assets`; no retired native source tree is
kept as a packaging input or reference copy.

## Signing and notarization

Signing is conditional, and release intent is always explicit. Every normal
build is stamped with `resources/INTERNAL-BUILD.txt` even if signing credentials
happen to be present. Set `HERMES_STUDIO_RELEASE=1` only on a release job; macOS
and Windows then make incomplete credentials a hard failure instead of silently
producing an internal build.

For macOS, configure either `CSC_LINK` or `CSC_NAME` and one notarization mode:

- `APPLE_NOTARY_PROFILE`, or
- `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` together.

`APPLE_API_KEY` may be a `.p8` path or inline private-key content. Inline
content is written to a mode-0600 temporary file and removed after submission.
electron-builder signs `Contents/Resources/sidecar/daemon` explicitly through
`mac.binaries`. The `afterSign` hook verifies that nested executable directly,
verifies the complete app with `codesign --deep --strict`, submits it with
`notarytool`, staples the ticket, and validates the staple.

For Windows, configure `WIN_CSC_LINK`, `CSC_LINK`, or `CSC_NAME` using the
electron-builder signing mechanism. `.exe` is an explicit signing extension,
and `afterSign` requires valid Authenticode signatures on both Hermes Studio
and `resources/sidecar/daemon.exe`.

Linux has no nested code-signing requirement in this builder. Normal Linux
packages remain marked internal; an explicit `HERMES_STUDIO_RELEASE=1` build is
allowed so CI can publish artifacts after its independently reviewed
package/repository signing step.

## Packaged smoke gate

The canonical native acceptance command is:

```bash
npm run test:packaged
```

It builds the sidecar and app, creates the current-host unpacked package, then
launches the packaged executable through Playwright's Electron driver. The
smoke gate verifies:

- the renderer loads from `hermes-studio://app/`;
- the frozen preload bridge is present and `app.nativeState()` reports a
  packaged process;
- the packaged sidecar reaches authenticated loopback health;
- `node-pty` starts and returns a unique sentinel through the frozen bridge;
- the packaged sidecar and PTY payloads are in their exact resource paths;
- the POSIX sidecar and `spawn-helper` are executable; and
- closing Electron completes coordinated cleanup and the sidecar health
  endpoint stops responding.

To re-run only the validation/launch step against an existing unpacked output:

```bash
npm run test:packaged:existing
```

Linux runners need a graphical session (normally Xvfb). The smoke is
current-host only and intentionally does not claim cross-target coverage.

## Manual native acceptance

Before publication, also complete the capability checklist in
[NATIVE_BRIDGE.md](./NATIVE_BRIDGE.md) on every native runner. In particular,
confirm microphone permission, notifications, pickers and drag/drop, restart
recovery, denied navigation/webviews/permissions, single-instance behavior,
and clean quit behavior in the signed installer output. Renderer DevTools must
expose neither Node/raw Electron APIs nor the private workspace-grant token.

There is intentionally no updater bridge or update-control UI in this release.
