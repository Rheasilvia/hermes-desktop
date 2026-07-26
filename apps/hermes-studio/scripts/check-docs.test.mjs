import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { validateDocs } from './check-docs.mjs';

const canonicalFiles = [
  'README.md',
  'AGENTS.md',
  'apps/hermes-studio/README.md',
  'apps/hermes-studio/AGENTS.md',
  'apps/hermes-studio/CLAUDE.md',
  'apps/hermes-studio/DESIGN.md',
  'apps/hermes-studio/docs/ARCHITECTURE.md',
  'apps/hermes-studio/docs/API_CONTRACTS.md',
  'apps/hermes-studio/docs/NATIVE_BRIDGE.md',
  'apps/hermes-studio/docs/RELEASE.md',
  'apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md',
];

const historyFiles = [
  'apps/hermes-studio/docs/history/ARCHITECTURE-bridge-design.md',
  'apps/hermes-studio/docs/history/desktop-api-contracts.md',
  'apps/hermes-studio/docs/history/electron-to-tauri-port-roadmap.md',
  'apps/hermes-studio/docs/history/desktop-p0-tui-parity.md',
  'apps/hermes-studio/docs/history/TODO-TUI-PARITY.md',
  'apps/hermes-studio/docs/history/claude-desktop-tech-stack.md',
];

const rootPlans = [
  'docs/plans/2026-05-11-git-diff-panel-design.md',
  'docs/plans/2026-06-10-tauri-desktop-workspace-sandbox.md',
  'docs/plans/2026-06-10-tauri-desktop-workspace-sandbox-v2.md',
];

function put(root, relativePath, contents = '# Document\n') {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function validFixture() {
  const root = mkdtempSync(join(tmpdir(), 'studio-docs-'));
  for (const file of canonicalFiles) put(root, file);
  put(
    root,
    'README.md',
    '# Root\n\n## Two desktop products\n\nHermes Studio lives in `apps/hermes-studio`; the separate Hermes Desktop lives in `apps/desktop`. They have independent renderer and backend contracts. `npm run dev` starts the sidecar on port `0` and reads `READY <port>`; port 18080 is only for `npm run backend`.\n',
  );
  put(
    root,
    'apps/hermes-studio/README.md',
    '# Studio\n\n## Installation\n\nRun `npm install`, `npm run pack`, `npm run dist`, and `npm run test:packaged`.\n\n## Relationship to Hermes Desktop\n\n`apps/desktop` is a separate product with an independent app identity and UI state. Both may use one Hermes profile, but concurrent work on the same session is unsupported and Studio returns `SESSION_BUSY` (409) for a second turn.\n\n## Troubleshooting\n\nInspect the Studio log and run the packaged smoke test.\n',
  );
  put(
    root,
    'apps/hermes-studio/docs/ARCHITECTURE.md',
    '# Architecture\n\n## Process and trust boundaries\n\nElectron main isolates the renderer and owns the sidecar.\n\n## Startup and recovery\n\nRestart with bounded recovery.\n',
  );
  put(
    root,
    'apps/hermes-studio/docs/NATIVE_BRIDGE.md',
    '# Native bridge\n\n## Renderer API\n\nOnly the current Electron bridge is active.\n\n## Capability ledger\n\n| Public bridge API/event | Legacy origin | Main validation/ownership | Unit/automated evidence | Packaged acceptance |\n| --- | --- | --- | --- | --- |\n| `app.version()` | old version | trusted sender | routing test | packaged version |\n| `backend.restart()` | lifecycle addition | trusted sender; the same token and workspace grant remain unchanged while only the child, port, and SidecarInfo update | restart test | packaged child and port change while token and grant remain stable |\n| `backend.onReady()` | old ready event | frozen event payload | unsubscribe test | packaged ready event |\n| `backend.onRestarted()` | lifecycle event | replacement SidecarInfo carries the updated port and same token; hidden grant remains unchanged | restart event test | reconnect to the new port with the same token and grant |\n| `window.startDrag()` | old window plugin | trusted sender; always returns `WINDOW_DRAG_REGION_REQUIRED`; there is no programmatic drag | native-bridge-main rejection test | CSS `-webkit-app-region: drag` moves the window and a direct API call is stably rejected |\n\nLegacy Tauri entries in this ledger are retired dispositions.\n\n## Request validation\n\nCurrent boundary rules only.\n\n## Verification\n\n### Retired-surface search\n\nThe final search verifies that Tauri imports stay absent.\n\n### Automated and packaged evidence\n\nCurrent evidence only.\n',
  );
  put(
    root,
    'apps/hermes-studio/src/shared/native-bridge.ts',
    'export type Unsubscribe = () => void\n\nexport interface HermesStudioBridge {\n  app: {\n    version(): Promise<string>\n  }\n  backend: {\n    restart(): Promise<string>\n    onReady(callback: (value: string) => void): Unsubscribe\n    onRestarted(callback: (value: string) => void): Unsubscribe\n  }\n  window: {\n    startDrag(): Promise<void>\n  }\n}\n',
  );
  put(
    root,
    'apps/hermes-studio/docs/API_CONTRACTS.md',
    '# API contracts\n\n## Namespace and REST authority\n\n`/desktop/api` remains an internal compatibility namespace for the Studio adapter and sidecar tests; it is not a public API or an old-host dependency. Every payload is defined by the linked [health router](../sidecar/daemon/routers/health.py), [events router](../sidecar/daemon/routers/events.py), and [error schema](../sidecar/daemon/schemas/error.py). Failures use `ErrorEnvelope`.\n\n## SSE event stream\n\n`GET /desktop/api/events/stream?token=...` emits `{ session_id, seq, type, payload }`; payload types are the renderer `GatewayEventMap`. A positive sequence is accepted only when strictly greater than the last sequence for that session. On reconnect the client replays durable messages and the server replays pending interactions.\n',
  );
  put(root, 'apps/hermes-studio/sidecar/daemon/routers/health.py', 'router = APIRouter()\n');
  put(root, 'apps/hermes-studio/sidecar/daemon/routers/events.py', 'router = APIRouter()\n');
  put(root, 'apps/hermes-studio/sidecar/daemon/schemas/error.py', 'class ErrorEnvelope: ...\n');
  put(
    root,
    'apps/hermes-studio/docs/RELEASE.md',
    '# Release\n\nThe [native workflow](../../../.github/workflows/studio-native.yml) runs macOS arm64 on `macos-15`, macOS x64 on `macos-15-intel`, Windows x64 on `windows-2025`, and Linux x64 on `ubuntu-24.04`.\n\n```bash\nnpm run dist:mac # DMG\nnpm run dist:win # NSIS\nnpm run dist:linux # AppImage, deb, rpm\n```\n\n`Hermes-Studio-${version}-${os}-${arch}.${ext}`\n\n## Signing and notarization\n\n`INTERNAL-BUILD.txt` and `HERMES_STUDIO_RELEASE=1`. There is intentionally no updater bridge.\n',
  );
  put(root, '.github/workflows/studio-native.yml', 'name: Hermes Studio Native\n');
  put(
    root,
    'apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md',
    '# ADR\n\n- Status: Accepted\n\n## Context\n\nThe Tauri host is historical.\n\n## Decision\n\nRetain the SolidJS renderer over REST and SSE. `apps/desktop` is not Hermes Studio and is not a runtime dependency. Studio has the independent appId `com.hermes-agent.studio`, userData directory `hermes-studio-electron`, and installation identity. There is no migration of prior local UI state. Version 1 has no updater. Only one active turn per session is allowed; a second same-session request returns `SESSION_BUSY` (409), and concurrent use of the same profile and session across clients is unsupported.\n\n12. The former `src-tauri` source tree has been deleted.\n\n## Consequences\n\nOnly Electron is current.\n\n## Alternatives considered\n\nThe Tauri alternative was rejected. JSON-RPC over UDS or a Windows Named\nPipe is deferred until a concrete transport requirement justifies a second protocol.\n\n## Superseded records\n\nHistorical Tauri records remain linked here.\n',
  );
  for (const file of historyFiles) {
    put(
      root,
      file,
      '# Historical document\n\n> **Status: Superseded.** See [ADR-001](../decisions/ADR-001-electron-shell.md).\n\nRetained body.\n',
    );
  }
  for (const file of rootPlans) {
    put(
      root,
      file,
      '# Historical plan\n\n> **Status: Superseded.** See [ADR-001](../../apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md).\n',
    );
  }
  put(
    root,
    'plans/desktop-conversation-real-data.md',
    '# Historical plan\n\n> **Status: Superseded.** See [ADR-001](../apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md), [API](../apps/hermes-studio/docs/API_CONTRACTS.md), and [bridge](../apps/hermes-studio/docs/NATIVE_BRIDGE.md).\n',
  );
  put(
    root,
    'apps/hermes-studio/package.json',
    `${JSON.stringify({
      scripts: {
        dev: 'vite',
        backend: 'python -m daemon',
        build: 'vite build',
        pack: 'electron-builder --dir',
        dist: 'electron-builder',
        'dist:mac': 'electron-builder --mac dmg',
        'dist:win': 'electron-builder --win nsis',
        'dist:linux': 'electron-builder --linux AppImage deb rpm',
        typecheck: 'tsc --noEmit',
        lint: 'eslint src electron',
        test: 'vitest run',
        'test:e2e': 'playwright test',
        'test:packaged': 'node scripts/test-packaged.mjs',
        'docs:check': 'node scripts/check-docs.mjs',
      },
    })}\n`,
  );
  return root;
}

test('accepts the canonical Electron documentation layout', () => {
  assert.deepEqual(validateDocs(validFixture()), []);
});

test('reports missing canonical documents and old active locations', () => {
  const root = validFixture();
  rmSync(join(root, 'apps/hermes-studio/DESIGN.md'));
  put(root, 'apps/hermes-studio/docs/ARCHITECTURE-bridge-design.md');

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('missing canonical document')));
  assert.ok(errors.some(error => error.includes('old active location')));
});

test('rejects retired host build scripts', () => {
  const root = validFixture();
  const packagePath = join(root, 'apps/hermes-studio/package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  packageJson.scripts['tauri:build'] = 'tauri build';
  writeFileSync(packagePath, `${JSON.stringify(packageJson)}\n`);

  assert.ok(validateDocs(root).some(error => error.includes('retired host script')));
});

test('reports npm commands documented without matching package scripts', () => {
  const root = validFixture();
  put(root, 'apps/hermes-studio/README.md', '# Studio\n\nRun `npm run missing-script`.\n');

  assert.ok(validateDocs(root).some(error => error.includes('missing-script')));
});

test('reports broken relative Markdown links', () => {
  const root = validFixture();
  put(root, 'apps/hermes-studio/README.md', '# Studio\n\nSee [missing](./docs/DOES-NOT-EXIST.md).\n');

  assert.ok(validateDocs(root).some(error => error.includes('DOES-NOT-EXIST.md')));
});

test('rejects retired host and directory descriptions in active docs', () => {
  const root = validFixture();
  put(root, 'apps/hermes-studio/DESIGN.md', '# Design\n\nThe current Tauri app lives in `desktop/src`.\n');

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('retired Tauri')));
  assert.ok(errors.some(error => error.includes('retired desktop/ path')));
});

test('allows retired terms only in scoped historical sections and regression fixtures', () => {
  const root = validFixture();
  const adrPath = join(root, 'apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md');
  const bridgePath = join(root, 'apps/hermes-studio/docs/NATIVE_BRIDGE.md');
  const architecturePath = join(root, 'apps/hermes-studio/docs/ARCHITECTURE.md');
  writeFileSync(adrPath, readFileSync(adrPath, 'utf8').replace(
    '## Context\n',
    '## Context\n\nTauri used the prior `desktop/src` path.\n',
  ));
  writeFileSync(bridgePath, readFileSync(bridgePath, 'utf8').replace(
    '## Capability ledger\n',
    '## Capability ledger\n\nLegacy Tauri capability: `src-tauri`.\n',
  ));
  writeFileSync(architecturePath, `${readFileSync(architecturePath, 'utf8')}\nA legacy-key regression fixture retains one Tauri storage key.\n`);

  assert.deepEqual(validateDocs(root), []);
});

test('rejects retired terms outside the ADR and bridge historical sections', () => {
  const root = validFixture();
  const adrPath = join(root, 'apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md');
  const bridgePath = join(root, 'apps/hermes-studio/docs/NATIVE_BRIDGE.md');
  writeFileSync(adrPath, readFileSync(adrPath, 'utf8').replace(
    '## Consequences\n',
    '## Consequences\n\nTauri is still a supported current host.\n',
  ));
  writeFileSync(bridgePath, `${readFileSync(bridgePath, 'utf8')}\nTauri is still a supported current host.\n`);

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('ADR-001-electron-shell.md') && error.includes('retired Tauri')));
  assert.ok(errors.some(error => error.includes('NATIVE_BRIDGE.md') && error.includes('retired Tauri')));
});

test('requires semantic structure in canonical authority documents', () => {
  const root = validFixture();
  put(root, 'README.md', '# Root\n');
  put(root, 'apps/hermes-studio/README.md', '# Studio\n');
  put(root, 'apps/hermes-studio/docs/ARCHITECTURE.md', '# Architecture\n');
  put(root, 'apps/hermes-studio/docs/API_CONTRACTS.md', '# API\n');
  put(root, 'apps/hermes-studio/docs/NATIVE_BRIDGE.md', '# Native bridge\n');
  put(root, 'apps/hermes-studio/docs/RELEASE.md', '# Release\n');
  put(root, 'apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md', '# ADR\n');

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('process and trust boundaries')));
  assert.ok(errors.some(error => error.includes('two desktop products')));
  assert.ok(errors.some(error => error.includes('port-zero handshake')));
  assert.ok(errors.some(error => error.includes('installation section')));
  assert.ok(errors.some(error => error.includes('official Desktop comparison')));
  assert.ok(errors.some(error => error.includes('internal compatibility namespace')));
  assert.ok(errors.some(error => error.includes('SSE envelope fields')));
  assert.ok(errors.some(error => error.includes('capability ledger section')));
  assert.ok(errors.some(error => error.includes('macOS distribution target')));
  assert.ok(errors.some(error => error.includes('native packaging workflow')));
  assert.ok(errors.some(error => error.includes('Windows x64 runner')));
  assert.ok(errors.some(error => error.includes('accepted status')));
  assert.ok(errors.some(error => error.includes('deferred local JSON-RPC transport')));
  assert.ok(errors.some(error => error.includes('independent application identity')));
  assert.ok(errors.some(error => error.includes('no prior UI-state migration')));
  assert.ok(errors.some(error => error.includes('version-one no-updater decision')));
  assert.ok(errors.some(error => error.includes('same-session concurrency limit')));
  assert.ok(errors.some(error => error.includes('same-profile cross-client limit')));
  assert.ok(errors.some(error => error.includes('retired source removal')));
});

test('requires every public native bridge member to have complete ledger evidence', () => {
  const root = validFixture();
  const bridgeSource = join(root, 'apps/hermes-studio/src/shared/native-bridge.ts');
  writeFileSync(
    bridgeSource,
    readFileSync(bridgeSource, 'utf8').replace(
      'version(): Promise<string>',
      'version(): Promise<string>\n    quit(): Promise<void>',
    ),
  );

  let errors = validateDocs(root);
  assert.ok(errors.some(error => error.includes('app.quit()')));

  const bridgeDoc = join(root, 'apps/hermes-studio/docs/NATIVE_BRIDGE.md');
  writeFileSync(
    bridgeDoc,
    readFileSync(bridgeDoc, 'utf8').replace(
      '| `app.version()` | old version | trusted sender | routing test | packaged version |',
      '| `app.version()` | old version |  | routing test | packaged version |',
    ),
  );
  errors = validateDocs(root);
  assert.ok(errors.some(error => error.includes('app.version()') && error.includes('validation')));
});

test('rejects stale ledger rows after a public bridge member is removed', () => {
  const root = validFixture();
  const bridgeSource = join(root, 'apps/hermes-studio/src/shared/native-bridge.ts');
  writeFileSync(
    bridgeSource,
    readFileSync(bridgeSource, 'utf8').replace('    version(): Promise<string>\n', ''),
  );

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('stale capability-ledger row for app.version()')));
});

test('requires the startDrag ledger row to document stable rejection and CSS acceptance', () => {
  const root = validFixture();
  const bridgeDoc = join(root, 'apps/hermes-studio/docs/NATIVE_BRIDGE.md');
  writeFileSync(
    bridgeDoc,
    readFileSync(bridgeDoc, 'utf8')
      .replace('always returns `WINDOW_DRAG_REGION_REQUIRED`; there is no programmatic drag', 'starts a native programmatic drag')
      .replace('CSS `-webkit-app-region: drag` moves the window and a direct API call is stably rejected', 'the bridge moves the window'),
  );

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('window.startDrag()') && error.includes('stable rejection')));
  assert.ok(errors.some(error => error.includes('window.startDrag()') && error.includes('CSS drag-region acceptance')));
});

test('requires restart rows to document stable manager secrets and updated process identity', () => {
  const root = validFixture();
  const bridgeDoc = join(root, 'apps/hermes-studio/docs/NATIVE_BRIDGE.md');
  writeFileSync(
    bridgeDoc,
    readFileSync(bridgeDoc, 'utf8')
      .replace('the same token and workspace grant remain unchanged while only the child, port, and SidecarInfo update', 'credential replacement creates a new credential')
      .replace('replacement SidecarInfo carries the updated port and same token; hidden grant remains unchanged', 'replacement SidecarInfo carries a new credential'),
  );

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('backend.restart()') && error.includes('stable token and grant')));
  assert.ok(errors.some(error => error.includes('backend.onRestarted()') && error.includes('updated SidecarInfo')));
});

test('requires API contracts to link every sidecar router and schema source', () => {
  const root = validFixture();
  put(root, 'apps/hermes-studio/sidecar/daemon/routers/new_surface.py', 'router = APIRouter()\n');
  put(root, 'apps/hermes-studio/sidecar/daemon/schemas/new_surface.py', 'class NewPayload: ...\n');

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('routers/new_surface.py')));
  assert.ok(errors.some(error => error.includes('schemas/new_surface.py')));
});

test('rejects restoration of the retired native source tree', () => {
  const root = validFixture();
  put(root, 'apps/hermes-studio/src-tauri/Cargo.toml', '[package]\nname = "retired"\n');

  assert.ok(validateDocs(root).some(error => error.includes('src-tauri')));
});

test('requires the real-data history plan to link current contracts', () => {
  const root = validFixture();
  put(
    root,
    'plans/desktop-conversation-real-data.md',
    '# Historical plan\n\n> **Status: Superseded.** See [ADR-001](../apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md).\n',
  );

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('API_CONTRACTS.md')));
  assert.ok(errors.some(error => error.includes('NATIVE_BRIDGE.md')));
});
