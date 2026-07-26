import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertNativeBinaryTarget,
  findPackagedApplication,
  inspectNativeBinary,
  parseSmokeArguments,
  resolvePackagedApplication,
  validatePackagedLayout,
} from './packaged-smoke.mjs'

function nativeFixture(platform, arch) {
  if (platform === 'darwin') {
    const bytes = Buffer.alloc(32)
    bytes.writeUInt32LE(0xfeedfacf, 0)
    bytes.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4)
    return bytes
  }
  if (platform === 'linux') {
    const bytes = Buffer.alloc(64)
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
    bytes.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18)
    return bytes
  }
  const bytes = Buffer.alloc(256)
  bytes.set([0x4d, 0x5a])
  bytes.writeUInt32LE(128, 0x3c)
  bytes.set([0x50, 0x45, 0, 0], 128)
  bytes.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 132)
  return bytes
}

function writeNative(file, platform, arch, mode = 0o755) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, nativeFixture(platform, arch), { mode })
  fs.chmodSync(file, mode)
}

function createMacPackage(releaseRoot, directory, arch) {
  const app = path.join(releaseRoot, directory, 'Hermes Studio.app')
  const executable = path.join(app, 'Contents', 'MacOS', 'Hermes Studio')
  const resources = path.join(app, 'Contents', 'Resources')
  const nodePty = path.join(resources, 'app.asar.unpacked', 'dist', 'node_modules', 'node-pty')
  const prebuild = path.join(nodePty, 'prebuilds', `darwin-${arch}`)
  writeNative(executable, 'darwin', arch)
  writeNative(path.join(resources, 'sidecar', 'daemon'), 'darwin', arch)
  fs.mkdirSync(path.join(nodePty, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(resources, 'app.asar'), 'asar')
  fs.writeFileSync(path.join(nodePty, 'package.json'), '{}')
  fs.writeFileSync(path.join(nodePty, 'lib', 'index.js'), '')
  writeNative(path.join(prebuild, 'pty.node'), 'darwin', arch)
  writeNative(path.join(prebuild, 'spawn-helper'), 'darwin', arch)
  return { app, executable }
}

test('inspects and enforces PE, ELF, and Mach-O architecture headers', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-native-header-'))
  try {
    for (const platform of ['darwin', 'linux', 'win32']) {
      for (const arch of ['x64', 'arm64']) {
        const file = path.join(root, `${platform}-${arch}`)
        writeNative(file, platform, arch)
        assert.deepEqual(inspectNativeBinary(file), { platform, architectures: [arch] })
        assert.doesNotThrow(() => assertNativeBinaryTarget(file, platform, arch))
        const other = arch === 'x64' ? 'arm64' : 'x64'
        assert.throws(() => assertNativeBinaryTarget(file, platform, other), /target mismatch/i)
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('discovers and validates the macOS packaged layout including target-native payloads', () => {
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-package-'))
  try {
    const { executable } = createMacPackage(releaseRoot, 'mac-arm64', 'arm64')
    const packaged = findPackagedApplication(releaseRoot, 'darwin', 'arm64')
    assert.equal(packaged.executablePath, fs.realpathSync(executable))
    const layout = validatePackagedLayout(packaged, 'darwin', 'arm64')
    assert.ok(layout.nativePayloads.some((file) => file.endsWith('pty.node')))
    assert.ok(layout.nativePayloads.some((file) => file.endsWith('spawn-helper')))
  } finally {
    fs.rmSync(releaseRoot, { recursive: true, force: true })
  }
})

test('does not select a stale expected directory with the wrong architecture', () => {
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-package-'))
  try {
    createMacPackage(releaseRoot, 'mac-arm64', 'x64')
    const current = createMacPackage(releaseRoot, 'current-arm64', 'arm64')
    const packaged = findPackagedApplication(releaseRoot, 'darwin', 'arm64')
    assert.equal(packaged.appPath, fs.realpathSync(current.app))
  } finally {
    fs.rmSync(releaseRoot, { recursive: true, force: true })
  }
})

test('requires --app-path when multiple matching fallback packages exist', () => {
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-package-'))
  try {
    createMacPackage(releaseRoot, 'first', 'arm64')
    createMacPackage(releaseRoot, 'second', 'arm64')
    assert.throws(
      () => findPackagedApplication(releaseRoot, 'darwin', 'arm64'),
      /multiple.*--app-path/is,
    )
  } finally {
    fs.rmSync(releaseRoot, { recursive: true, force: true })
  }
})

test('resolves explicit app bundles, installation roots, and executable paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-explicit-'))
  try {
    const mac = createMacPackage(root, 'mac-arm64', 'arm64')
    assert.equal(resolvePackagedApplication(mac.app, 'darwin', 'arm64').executablePath, fs.realpathSync(mac.executable))
    assert.equal(resolvePackagedApplication(mac.executable, 'darwin', 'arm64').appPath, fs.realpathSync(mac.app))

    const linux = path.join(root, 'installed-linux')
    const executable = path.join(linux, 'hermes-studio')
    writeNative(executable, 'linux', 'x64')
    fs.mkdirSync(path.join(linux, 'resources'), { recursive: true })
    assert.equal(resolvePackagedApplication(linux, 'linux', 'x64').executablePath, fs.realpathSync(executable))
    assert.equal(resolvePackagedApplication(executable, 'linux', 'x64').appPath, fs.realpathSync(linux))

    const uninstaller = path.join(linux, 'Uninstall Hermes Studio.exe')
    writeNative(uninstaller, 'win32', 'x64')
    assert.throws(
      () => resolvePackagedApplication(uninstaller, 'win32', 'x64'),
      /does not name the Hermes Studio executable/i,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('parses only one absolute --app-path argument', () => {
  const absolute = path.resolve('/tmp', 'Hermes Studio.app')
  assert.deepEqual(parseSmokeArguments([]), { appPath: undefined })
  assert.deepEqual(parseSmokeArguments(['--app-path', absolute]), { appPath: absolute })
  assert.deepEqual(parseSmokeArguments([`--app-path=${absolute}`]), { appPath: absolute })
  assert.throws(() => parseSmokeArguments(['--app-path', 'relative']), /must be absolute/i)
  assert.throws(() => parseSmokeArguments(['--unknown']), /unknown/i)
})

test('rejects a package whose POSIX spawn-helper is not executable', () => {
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-package-'))
  try {
    const app = path.join(releaseRoot, 'linux-arm64-unpacked')
    const resources = path.join(app, 'resources')
    const nodePty = path.join(resources, 'app.asar.unpacked', 'dist', 'node_modules', 'node-pty')
    const prebuild = path.join(nodePty, 'prebuilds', 'linux-arm64')
    writeNative(path.join(app, 'hermes-studio'), 'linux', 'arm64')
    writeNative(path.join(resources, 'sidecar', 'daemon'), 'linux', 'arm64')
    fs.mkdirSync(path.join(nodePty, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(resources, 'app.asar'), 'asar')
    fs.writeFileSync(path.join(nodePty, 'package.json'), '{}')
    fs.writeFileSync(path.join(nodePty, 'lib', 'index.js'), '')
    writeNative(path.join(prebuild, 'pty.node'), 'linux', 'arm64')
    writeNative(path.join(prebuild, 'spawn-helper'), 'linux', 'arm64', 0o644)

    const packaged = findPackagedApplication(releaseRoot, 'linux', 'arm64')
    assert.throws(() => validatePackagedLayout(packaged, 'linux', 'arm64'), /spawn-helper.*executable/i)
  } finally {
    fs.rmSync(releaseRoot, { recursive: true, force: true })
  }
})
