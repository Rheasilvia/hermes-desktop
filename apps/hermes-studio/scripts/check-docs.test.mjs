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
    'apps/hermes-studio/docs/ARCHITECTURE.md',
    '# Architecture\n\n## Process and trust boundaries\n\nElectron main isolates the renderer and owns the sidecar.\n\n## Startup and recovery\n\nRestart with bounded recovery.\n',
  );
  put(
    root,
    'apps/hermes-studio/docs/NATIVE_BRIDGE.md',
    '# Native bridge\n\n## Capability ledger\n\n| Legacy registered entry | Electron renderer API | Main validation/ownership | Unit/automated evidence | Packaged acceptance |\n| --- | --- | --- | --- | --- |\n| old | new | validate | test | package |\n',
  );
  put(
    root,
    'apps/hermes-studio/docs/RELEASE.md',
    '# Release\n\n```bash\nnpm run dist:mac # DMG\nnpm run dist:win # NSIS\nnpm run dist:linux # AppImage, deb, rpm\n```\n\n`Hermes-Studio-${version}-${os}-${arch}.${ext}`\n\n## Signing and notarization\n\n`INTERNAL-BUILD.txt` and `HERMES_STUDIO_RELEASE=1`. There is intentionally no updater bridge.\n',
  );
  put(
    root,
    'apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md',
    '# ADR\n\n- Status: Accepted\n\n## Decision\n\nRetain the SolidJS renderer over REST and SSE. `apps/desktop` is not Hermes Studio and is not a runtime dependency.\n\n## Alternatives\n\nAdopting it was Rejected.\n',
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

test('allows migration terms only in the ADR, capability ledger, and superseded history', () => {
  const root = validFixture();
  const adrPath = join(root, 'apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md');
  const bridgePath = join(root, 'apps/hermes-studio/docs/NATIVE_BRIDGE.md');
  const architecturePath = join(root, 'apps/hermes-studio/docs/ARCHITECTURE.md');
  writeFileSync(adrPath, `${readFileSync(adrPath, 'utf8')}\nTauri used the prior \`desktop/src\` path.\n`);
  writeFileSync(bridgePath, `${readFileSync(bridgePath, 'utf8')}\nLegacy Tauri capability: \`src-tauri\`.\n`);
  writeFileSync(architecturePath, `${readFileSync(architecturePath, 'utf8')}\nA legacy-key regression fixture retains one Tauri storage key.\n`);

  assert.deepEqual(validateDocs(root), []);
});

test('requires semantic structure in canonical authority documents', () => {
  const root = validFixture();
  put(root, 'apps/hermes-studio/docs/ARCHITECTURE.md', '# Architecture\n');
  put(root, 'apps/hermes-studio/docs/NATIVE_BRIDGE.md', '# Native bridge\n');
  put(root, 'apps/hermes-studio/docs/RELEASE.md', '# Release\n');
  put(root, 'apps/hermes-studio/docs/decisions/ADR-001-electron-shell.md', '# ADR\n');

  const errors = validateDocs(root);

  assert.ok(errors.some(error => error.includes('process and trust boundaries')));
  assert.ok(errors.some(error => error.includes('capability ledger section')));
  assert.ok(errors.some(error => error.includes('macOS distribution target')));
  assert.ok(errors.some(error => error.includes('accepted status')));
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
