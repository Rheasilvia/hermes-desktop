# Hermes Studio Release Process

Hermes Studio packages Electron plus a host-native PyInstaller sidecar. There
is no automatic updater in the first Electron release.

## Host-native build

Run each distribution build on its target operating system; PyInstaller output
is not cross-platform. From the repository root:

```bash
cd apps/hermes-studio
npm run backend:build
npm run build
npm run pack
```

`npm run backend:build` invokes the cross-platform Python entry
`sidecar/scripts/build_dist.py`. It synchronizes the frozen sidecar build
environment, runs PyInstaller, stages
`sidecar/dist/electron/daemon` (`daemon.exe` on Windows), preserves executable
bits on macOS/Linux, removes stale staging output from other platforms, and
smoke-tests `READY <port>` plus the loopback health endpoint. `npm run pack`
repeats the sidecar build before producing an unpacked electron-builder
application. `npm run dist` builds the configured installers.

The active electron-builder targets are DMG on macOS, NSIS on Windows, and
AppImage/deb/rpm on Linux. Artifacts use:

```text
Hermes-Studio-${version}-${os}-${arch}.${ext}
```

CI should use native macOS, Windows, and Linux runners. A path calculation unit
test covers all three staging layouts without claiming to cross-build them.

## Signing status

The current migration configuration does not provide production signing or
notarization credentials. Local unsigned packages are suitable for smoke tests,
not release distribution. A release pipeline must add platform-specific
signing/notarization and verify the staged sidecar signature as part of the
final app before publishing.

## Verification

Before publishing from a native runner:

```bash
cd apps/hermes-studio
npm run typecheck
npm run lint
npm test
npm run build
cd sidecar
uv sync --frozen --extra dev
uv run --frozen --extra dev python -m pytest -q
```

The sidecar build itself is intentionally excluded from ordinary unit tests;
tests exercise its target/path/argument logic without requiring PyInstaller.

## Native host acceptance

The Electron package must be tested as a package, not only from the Vite
development server. On each native runner, complete the capability-by-capability
checklist in [NATIVE_BRIDGE.md](./NATIVE_BRIDGE.md), then confirm:

- production loads from `hermes-studio://app/`, never `file://`;
- a second launch focuses the existing window;
- denied navigation, popups, webviews, and permissions stay denied;
- microphone access is prompted only for an explicit voice interaction;
- the signed macOS app contains the Studio main/inherit audio-input,
  JIT/unsigned-executable-memory, and native-library entitlements, and packaged
  microphone capture succeeds;
- Windows notifications use AppUserModelID `com.hermes-agent.studio` and a
  packaged toast is visibly delivered;
- a packaged macOS/Linux PTY starts successfully from the unpacked node-pty
  helper;
- backend failure leaves the shell open in degraded mode and recovery events
  reach the renderer;
- repeated quit requests remain blocked until cleanup closes all PTYs, revokes
  temporary handles/grants/staged attachments, and stops only the owned sidecar
  process;
- renderer DevTools expose neither Node/raw Electron APIs nor the private
  workspace-grant token;
- the packaged CSP contains only the exact app/sidecar origins needed at
  runtime.

There is intentionally no `check_for_updates` or `install_update` Electron
bridge surface. Do not publish an update-control UI for this release.
