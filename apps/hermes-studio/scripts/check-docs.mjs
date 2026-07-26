import {
  existsSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const studioRoot = 'apps/hermes-studio';

const canonicalPaths = [
  'README.md',
  'AGENTS.md',
  `${studioRoot}/README.md`,
  `${studioRoot}/AGENTS.md`,
  `${studioRoot}/CLAUDE.md`,
  `${studioRoot}/DESIGN.md`,
  `${studioRoot}/docs/ARCHITECTURE.md`,
  `${studioRoot}/docs/API_CONTRACTS.md`,
  `${studioRoot}/docs/NATIVE_BRIDGE.md`,
  `${studioRoot}/docs/RELEASE.md`,
  `${studioRoot}/docs/decisions/ADR-001-electron-shell.md`,
];

const historyPaths = [
  `${studioRoot}/docs/history/ARCHITECTURE-bridge-design.md`,
  `${studioRoot}/docs/history/desktop-api-contracts.md`,
  `${studioRoot}/docs/history/electron-to-tauri-port-roadmap.md`,
  `${studioRoot}/docs/history/desktop-p0-tui-parity.md`,
  `${studioRoot}/docs/history/TODO-TUI-PARITY.md`,
  `${studioRoot}/docs/history/claude-desktop-tech-stack.md`,
];

const oldActivePaths = [
  `${studioRoot}/docs/ARCHITECTURE-bridge-design.md`,
  `${studioRoot}/docs/desktop-api-contracts.md`,
  `${studioRoot}/docs/plans/electron-to-tauri-port-roadmap.md`,
  `${studioRoot}/docs/plans/desktop-p0-tui-parity.md`,
  `${studioRoot}/TODO-TUI-PARITY.md`,
  `${studioRoot}/claude-desktop-tech-stack.md`,
];

const supersededRootPlans = [
  'plans/desktop-conversation-real-data.md',
  'docs/plans/2026-05-11-git-diff-panel-design.md',
  'docs/plans/2026-06-10-tauri-desktop-workspace-sandbox.md',
  'docs/plans/2026-06-10-tauri-desktop-workspace-sandbox-v2.md',
];

const requiredScripts = [
  'dev',
  'build',
  'pack',
  'dist',
  'typecheck',
  'lint',
  'test',
  'test:e2e',
  'test:packaged',
  'docs:check',
];

const documentRequirements = new Map([
  [
    'README.md',
    [
      ['two desktop products section', /^## .*Two desktop products\s*$/imu],
      ['Hermes Studio product location', /Hermes Studio[\s\S]{0,240}apps\/hermes-studio/iu],
      ['Hermes Desktop product location', /Hermes Desktop[\s\S]{0,240}apps\/desktop/iu],
      ['independent product contracts', /separate|independent/iu],
      ['Electron development port-zero handshake', /npm run dev[\s\S]{0,500}port\s+`?0`?[\s\S]{0,240}READY/iu],
      ['standalone backend port', /18080[\s\S]{0,300}npm run backend|npm run backend[\s\S]{0,300}18080/iu],
    ],
  ],
  [
    `${studioRoot}/README.md`,
    [
      ['installation section', /^## .*Installation\s*$/imu],
      ['official Desktop comparison', /apps\/desktop[\s\S]{0,500}(?:separate|independent)|(?:separate|independent)[\s\S]{0,500}apps\/desktop/iu],
      ['same-session concurrency limit', /(?:same session|same-session)[\s\S]{0,300}(?:unsupported|SESSION_BUSY|409)|(?:SESSION_BUSY|409)[\s\S]{0,300}(?:same session|same-session)/iu],
      ['pack command', /npm run pack/u],
      ['distribution command', /npm run dist/u],
      ['packaged smoke command', /npm run test:packaged/u],
      ['troubleshooting section', /^## .*Troubleshooting\s*$/imu],
    ],
  ],
  [
    `${studioRoot}/docs/ARCHITECTURE.md`,
    [
      ['process and trust boundaries section', /^## Process and trust boundaries\s*$/imu],
      ['startup and recovery section', /^## Startup and recovery\s*$/imu],
      ['Electron main, renderer, and sidecar ownership', /Electron main[\s\S]*renderer[\s\S]*sidecar|sidecar[\s\S]*Electron main[\s\S]*renderer/iu],
    ],
  ],
  [
    `${studioRoot}/docs/API_CONTRACTS.md`,
    [
      ['internal compatibility namespace rationale', /\/desktop\/api[\s\S]{0,500}(?:internal compatibility|compatibility namespace)/iu],
      ['REST router source authority', /sidecar\/daemon\/routers\//u],
      ['REST schema source authority', /sidecar\/daemon\/schemas\//u],
      ['standard error envelope', /ErrorEnvelope/u],
      ['SSE stream endpoint', /\/desktop\/api\/events\/stream\?token=/u],
      ['SSE envelope fields', /session_id[\s\S]{0,160}\bseq\b[\s\S]{0,160}\btype\b[\s\S]{0,160}\bpayload\b/iu],
      ['renderer event payload authority', /GatewayEventMap/u],
      ['per-session sequence rule', /(?:strictly greater|greater than)[\s\S]{0,220}(?:last|previous)[\s\S]{0,120}(?:session|sequence)/iu],
      ['reconnect and replay behavior', /reconnect[\s\S]{0,500}replay|replay[\s\S]{0,500}reconnect/iu],
    ],
  ],
  [
    `${studioRoot}/docs/RELEASE.md`,
    [
      ['macOS distribution target', /npm run dist:mac[\s\S]*DMG/iu],
      ['Windows distribution target', /npm run dist:win[\s\S]*NSIS/iu],
      ['Linux distribution targets', /npm run dist:linux[\s\S]*AppImage[\s\S]*deb[\s\S]*rpm/iu],
      ['artifact naming pattern', /Hermes-Studio-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}/u],
      ['signing section', /^## Signing and notarization\s*$/imu],
      ['internal-build marker', /INTERNAL-BUILD\.txt/u],
      ['explicit release mode', /HERMES_STUDIO_RELEASE=1/u],
      ['no-updater policy', /no updater bridge|without an updater|updater is intentionally absent/iu],
      ['native packaging workflow', /\.github\/workflows\/studio-native\.yml/u],
      ['macOS arm64 runner', /macOS arm64[\s\S]{0,120}macos-15/iu],
      ['macOS x64 runner', /macOS x64[\s\S]{0,120}macos-15-intel/iu],
      ['Windows x64 runner', /Windows x64[\s\S]{0,120}windows-2025/iu],
      ['Linux x64 runner', /Linux x64[\s\S]{0,120}ubuntu-24\.04/iu],
    ],
  ],
  [
    `${studioRoot}/docs/decisions/ADR-001-electron-shell.md`,
    [
      ['accepted status', /Status:\s*Accepted/iu],
      ['decision section', /^## Decision\s*$/imu],
      ['SolidJS renderer decision', /SolidJS/iu],
      ['REST and SSE transport decision', /REST[\s\S]{0,120}\bSSE\b/iu],
      ['upstream Desktop not-adopted decision', /does not adopt[\s\S]{0,120}apps\/desktop|apps\/desktop[\s\S]{0,600}(?:Rejected|not Hermes Studio|not a runtime dependency)/iu],
      ['deferred local JSON-RPC transport', /JSON-RPC[\s\S]{0,240}(?:UDS|Unix domain socket)[\s\S]{0,240}Named\s+Pipe[\s\S]{0,300}defer|defer[\s\S]{0,300}JSON-RPC[\s\S]{0,240}(?:UDS|Unix domain socket)[\s\S]{0,240}Named\s+Pipe/iu],
      ['independent application identity', /com\.hermes-agent\.studio[\s\S]{0,300}hermes-studio-electron[\s\S]{0,300}(?:install|identity)/iu],
      ['no prior UI-state migration', /no migration[\s\S]{0,160}(?:UI|local state)|(?:UI|local state)[\s\S]{0,160}not migrated/iu],
      ['version-one no-updater decision', /(?:version 1|v1|first Electron release)[\s\S]{0,200}(?:no updater|updater.*absent)/iu],
      ['same-session concurrency limit', /(?:same session|same-session)[\s\S]{0,300}(?:SESSION_BUSY|409|unsupported)|(?:SESSION_BUSY|409)[\s\S]{0,300}(?:same session|same-session)/iu],
      ['same-profile cross-client limit', /same[\s\S]{0,80}profile[\s\S]{0,400}(?:no cross|lock|unsupported|concurrent)/iu],
      ['retired source removal', /src-tauri[\s\S]{0,100}(?:deleted|removed)|(?:deleted|removed)[\s\S]{0,100}src-tauri/iu],
    ],
  ],
]);

const ignoredDirectories = new Set([
  '.git',
  'dist',
  'node_modules',
  'out',
  'src-tauri',
]);

function walkMarkdown(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkMarkdown(path));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
      files.push(path);
    }
  }
  return files;
}

function activeMarkdownFiles(repoRoot) {
  const files = [join(repoRoot, 'README.md'), join(repoRoot, 'AGENTS.md')];
  for (const path of walkMarkdown(join(repoRoot, studioRoot))) {
    if (path.includes(`${join('docs', 'history')}/`)) continue;
    files.push(path);
  }
  return [...new Set(files)].filter(existsSync);
}

function markdownTargets(contents) {
  const targets = [];
  const pattern = /!?(?:\[[^\]]*\])\(([^)]+)\)/g;
  for (const match of contents.matchAll(pattern)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.includes('>')) {
      target = target.slice(1, target.indexOf('>'));
    } else {
      target = target.split(/\s+/u)[0];
    }
    targets.push(target);
  }
  return targets;
}

function isExternalTarget(target) {
  return (
    !target ||
    target.startsWith('#') ||
    target.startsWith('/') ||
    /^[a-z][a-z\d+.-]*:/iu.test(target)
  );
}

function checkLinks(repoRoot, file, errors) {
  const contents = readFileSync(file, 'utf8');
  for (const rawTarget of markdownTargets(contents)) {
    if (isExternalTarget(rawTarget)) continue;
    const pathPart = rawTarget.split('#', 1)[0].split('?', 1)[0];
    let decoded;
    try {
      decoded = decodeURIComponent(pathPart);
    } catch {
      errors.push(`${relative(repoRoot, file)}: invalid encoded link ${rawTarget}`);
      continue;
    }
    const target = resolve(dirname(file), decoded);
    if (!existsSync(target)) {
      errors.push(`${relative(repoRoot, file)}: broken relative link ${rawTarget}`);
    }
  }
}

function retiredTermsAllowed(relativePath, line) {
  if (relativePath.endsWith('docs/decisions/ADR-001-electron-shell.md')) return true;
  if (relativePath.endsWith('docs/NATIVE_BRIDGE.md')) return true;
  return /legacy(?:-| )key.*regression|regression.*legacy(?:-| )key/iu.test(line);
}

function checkRetiredDescriptions(repoRoot, file, errors) {
  const relativePath = relative(repoRoot, file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
  lines.forEach((line, index) => {
    if (retiredTermsAllowed(relativePath, line)) return;
    if (/\btauri\b|@tauri-apps|src-tauri|tauri:/iu.test(line)) {
      errors.push(`${relativePath}:${index + 1}: retired Tauri description in active documentation`);
    }
    const normalized = line
      .replaceAll('apps/desktop/', 'apps-desktop-reference/')
      .replaceAll('/desktop/api', '/studio-api')
      .replaceAll('hermes-desktop', 'studio-repository');
    if (/@desktop\/|\bdesktop\/(?:src|sidecar|src-tauri|docs|package(?:\.json)?)/u.test(normalized)) {
      errors.push(`${relativePath}:${index + 1}: retired desktop/ path in active documentation`);
    }
  });
}

function checkSupersededFile(repoRoot, relativePath, errors) {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) {
    errors.push(`missing superseded history document: ${relativePath}`);
    return;
  }
  const header = readFileSync(absolutePath, 'utf8').split(/\r?\n/u).slice(0, 12).join('\n');
  if (!/Status:\s*Superseded/iu.test(header)) {
    errors.push(`${relativePath}: missing Status: Superseded header`);
  }
  if (!/ADR-001-electron-shell\.md/u.test(header)) {
    errors.push(`${relativePath}: missing ADR-001 link in superseded header`);
  }
  if (relativePath === 'plans/desktop-conversation-real-data.md') {
    for (const currentDocument of ['API_CONTRACTS.md', 'NATIVE_BRIDGE.md']) {
      if (!header.includes(currentDocument)) {
        errors.push(`${relativePath}: missing ${currentDocument} link in superseded header`);
      }
    }
  }
}

function checkCanonicalStructure(repoRoot, errors) {
  for (const [relativePath, requirements] of documentRequirements) {
    const absolutePath = join(repoRoot, relativePath);
    if (!existsSync(absolutePath)) continue;
    const contents = readFileSync(absolutePath, 'utf8');
    for (const [description, pattern] of requirements) {
      if (!pattern.test(contents)) {
        errors.push(`${relativePath}: missing canonical structure: ${description}`);
      }
    }
  }

}

function parseNativeBridgeEntries(source) {
  const entries = [];
  let inBridge = false;
  let group = null;
  for (const line of source.split(/\r?\n/u)) {
    if (!inBridge) {
      if (/^export interface HermesStudioBridge\s*\{/u.test(line)) inBridge = true;
      continue;
    }
    const groupMatch = line.match(/^\s{2}([A-Za-z_$][\w$]*):\s*\{\s*$/u);
    if (groupMatch) {
      group = groupMatch[1];
      continue;
    }
    if (/^\s{2}\}\s*$/u.test(line)) {
      group = null;
      continue;
    }
    if (/^\}\s*$/u.test(line)) break;
    const memberMatch = group && line.match(/^\s{4}([A-Za-z_$][\w$]*)\s*\(/u);
    if (memberMatch) entries.push(`${group}.${memberMatch[1]}()`);
  }
  return entries;
}

function isMissingLedgerEvidence(value) {
  return !value || /^(?:—|-|TBD|TODO|N\/A)$/iu.test(value.trim());
}

function checkNativeBridgeLedger(repoRoot, errors) {
  const bridgePath = `${studioRoot}/docs/NATIVE_BRIDGE.md`;
  const sourcePath = `${studioRoot}/src/shared/native-bridge.ts`;
  const absoluteBridgePath = join(repoRoot, bridgePath);
  const absoluteSourcePath = join(repoRoot, sourcePath);
  if (!existsSync(absoluteBridgePath)) return;
  const bridge = readFileSync(absoluteBridgePath, 'utf8');
  if (!/^## Capability ledger\s*$/imu.test(bridge)) {
    errors.push(`${bridgePath}: missing canonical structure: capability ledger section`);
    return;
  }
  if (!existsSync(absoluteSourcePath)) {
    errors.push(`missing canonical document support file: ${sourcePath}`);
    return;
  }

  const lines = bridge.split(/\r?\n/u);
  const header = lines.find(line => /^\|.*(?:Public bridge|Renderer).*\|/iu.test(line));
  const columns = header
    ? header.split('|').slice(1, -1).map(column => column.trim())
    : [];
  const columnChecks = [
    ['public bridge API/event column', column => /public.*(?:bridge|renderer).*API|renderer.*API/iu.test(column)],
    ['legacy origin column', column => /legacy|old|former/iu.test(column)],
    ['validation column', column => /validation/iu.test(column)],
    ['unit-test evidence column', column => /unit|test|automated evidence/iu.test(column)],
    ['packaged acceptance column', column => /packaged acceptance/iu.test(column)],
  ];
  for (const [description, predicate] of columnChecks) {
    if (!columns.some(predicate)) errors.push(`${bridgePath}: missing capability-ledger ${description}`);
  }

  const ledgerRows = new Map();
  for (const line of lines) {
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    const entryMatch = cells[0]?.match(/^`([^`]+)`$/u);
    if (!entryMatch) continue;
    const entry = entryMatch[1];
    const rows = ledgerRows.get(entry) ?? [];
    rows.push(cells);
    ledgerRows.set(entry, rows);
  }

  const publicEntries = parseNativeBridgeEntries(readFileSync(absoluteSourcePath, 'utf8'));
  if (!publicEntries.length) {
    errors.push(`${sourcePath}: could not derive public HermesStudioBridge members`);
    return;
  }
  for (const entry of publicEntries) {
    const rows = ledgerRows.get(entry) ?? [];
    if (!rows.length) {
      errors.push(`${bridgePath}: missing capability-ledger row for ${entry}`);
      continue;
    }
    if (rows.length > 1) errors.push(`${bridgePath}: duplicate capability-ledger row for ${entry}`);
    const row = rows[0];
    for (const [columnIndex, description] of [[2, 'validation'], [3, 'unit/automated evidence'], [4, 'packaged acceptance']]) {
      if (isMissingLedgerEvidence(row[columnIndex])) {
        errors.push(`${bridgePath}: ${entry} is missing ${description}`);
      }
    }
  }
}

function checkApiSourceCoverage(repoRoot, errors) {
  const documentPath = `${studioRoot}/docs/API_CONTRACTS.md`;
  const absoluteDocumentPath = join(repoRoot, documentPath);
  if (!existsSync(absoluteDocumentPath)) return;
  const contents = readFileSync(absoluteDocumentPath, 'utf8');
  const sourceGroups = [
    ['routers', `${studioRoot}/sidecar/daemon/routers`, '../sidecar/daemon/routers'],
    ['schemas', `${studioRoot}/sidecar/daemon/schemas`, '../sidecar/daemon/schemas'],
  ];
  for (const [description, relativeDirectory, targetPrefix] of sourceGroups) {
    const directory = join(repoRoot, relativeDirectory);
    if (!existsSync(directory)) {
      errors.push(`missing canonical document support directory: ${relativeDirectory}`);
      continue;
    }
    const files = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.py') && entry.name !== '__init__.py')
      .map(entry => entry.name)
      .sort();
    for (const file of files) {
      const target = `${targetPrefix}/${file}`;
      if (!contents.includes(target)) {
        errors.push(`${documentPath}: missing ${description} source link ${target}`);
      }
    }
  }
}

function checkScripts(repoRoot, activeFiles, errors) {
  const packagePath = join(repoRoot, studioRoot, 'package.json');
  if (!existsSync(packagePath)) {
    errors.push(`missing canonical document support file: ${studioRoot}/package.json`);
    return;
  }
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  } catch (error) {
    errors.push(`${studioRoot}/package.json: invalid JSON (${error.message})`);
    return;
  }
  const scripts = packageJson.scripts ?? {};
  for (const name of requiredScripts) {
    if (typeof scripts[name] !== 'string' || !scripts[name].trim()) {
      errors.push(`${studioRoot}/package.json: missing required script ${name}`);
    }
  }
  if (scripts['docs:check'] !== 'node scripts/check-docs.mjs') {
    errors.push(`${studioRoot}/package.json: docs:check must run node scripts/check-docs.mjs`);
  }
  for (const [name, command] of Object.entries(scripts)) {
    if (/tauri/iu.test(name) || /\btauri\b/iu.test(String(command))) {
      errors.push(`${studioRoot}/package.json: retired host script ${name}`);
    }
  }

  const documented = new Set();
  for (const file of activeFiles.filter(file => relative(repoRoot, file) !== 'AGENTS.md')) {
    const contents = readFileSync(file, 'utf8');
    for (const match of contents.matchAll(/npm run ([a-z\d:_-]+)/giu)) {
      documented.add(match[1]);
    }
  }
  for (const name of documented) {
    if (typeof scripts[name] !== 'string') {
      errors.push(`documented npm script is missing from package.json: ${name}`);
    }
  }
}

export function validateDocs(repoRoot) {
  const root = resolve(repoRoot);
  const errors = [];

  for (const path of canonicalPaths) {
    if (!existsSync(join(root, path))) errors.push(`missing canonical document: ${path}`);
  }
  for (const path of oldActivePaths) {
    if (existsSync(join(root, path))) errors.push(`old active location must be moved to docs/history: ${path}`);
  }
  for (const path of historyPaths) checkSupersededFile(root, path, errors);
  for (const path of supersededRootPlans) checkSupersededFile(root, path, errors);
  checkCanonicalStructure(root, errors);
  checkNativeBridgeLedger(root, errors);
  checkApiSourceCoverage(root, errors);

  const retiredSourcePath = `${studioRoot}/src-tauri`;
  if (existsSync(join(root, retiredSourcePath))) {
    errors.push(`${retiredSourcePath}: retired native source tree must remain deleted`);
  }

  const activeFiles = activeMarkdownFiles(root);
  for (const file of activeFiles) {
    checkLinks(root, file, errors);
    checkRetiredDescriptions(root, file, errors);
  }
  checkScripts(root, activeFiles, errors);

  return errors.sort();
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const repoRoot = resolve(dirname(currentFile), '../../..');
  const errors = validateDocs(repoRoot);
  if (errors.length) {
    console.error('Hermes Studio documentation check failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log('Hermes Studio documentation check passed.');
  }
}
