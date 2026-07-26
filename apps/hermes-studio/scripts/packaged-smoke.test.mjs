import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  findPackagedApplication,
  validatePackagedLayout,
} from './packaged-smoke.mjs'

test('discovers and validates the macOS packaged layout including native payloads', () => {
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-package-'))
  try {
    const app = path.join(releaseRoot, 'mac-arm64', 'Hermes Studio.app')
    const executable = path.join(app, 'Contents', 'MacOS', 'Hermes Studio')
    const resources = path.join(app, 'Contents', 'Resources')
    const nodePty = path.join(resources, 'app.asar.unpacked', 'dist', 'node_modules', 'node-pty')
    const helper = path.join(nodePty, 'prebuilds', 'darwin-arm64', 'spawn-helper')
    fs.mkdirSync(path.dirname(executable), { recursive: true })
    fs.writeFileSync(executable, 'app')
    fs.chmodSync(executable, 0o755)
    fs.mkdirSync(path.join(resources, 'sidecar'), { recursive: true })
    fs.writeFileSync(path.join(resources, 'sidecar', 'daemon'), 'sidecar')
    fs.chmodSync(path.join(resources, 'sidecar', 'daemon'), 0o755)
    fs.writeFileSync(path.join(resources, 'app.asar'), 'asar')
    fs.mkdirSync(path.join(nodePty, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(nodePty, 'package.json'), '{}')
    fs.writeFileSync(path.join(nodePty, 'lib', 'index.js'), '')
    fs.mkdirSync(path.dirname(helper), { recursive: true })
    fs.writeFileSync(path.join(path.dirname(helper), 'pty.node'), 'native')
    fs.writeFileSync(helper, 'helper')
    fs.chmodSync(helper, 0o755)

    const packaged = findPackagedApplication(releaseRoot, 'darwin', 'arm64')
    assert.equal(packaged.executablePath, executable)
    assert.doesNotThrow(() => validatePackagedLayout(packaged, 'darwin', 'arm64'))
  } finally {
    fs.rmSync(releaseRoot, { recursive: true, force: true })
  }
})

test('rejects a package whose POSIX spawn-helper is not executable', () => {
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-package-'))
  try {
    const app = path.join(releaseRoot, 'linux-arm64-unpacked')
    const resources = path.join(app, 'resources')
    const nodePty = path.join(resources, 'app.asar.unpacked', 'dist', 'node_modules', 'node-pty')
    fs.mkdirSync(path.join(nodePty, 'lib'), { recursive: true })
    fs.mkdirSync(path.join(nodePty, 'prebuilds', 'linux-arm64'), { recursive: true })
    fs.writeFileSync(path.join(app, 'hermes-studio'), 'app')
    fs.chmodSync(path.join(app, 'hermes-studio'), 0o755)
    fs.mkdirSync(path.join(resources, 'sidecar'), { recursive: true })
    fs.writeFileSync(path.join(resources, 'sidecar', 'daemon'), 'sidecar')
    fs.chmodSync(path.join(resources, 'sidecar', 'daemon'), 0o755)
    fs.writeFileSync(path.join(resources, 'app.asar'), 'asar')
    fs.writeFileSync(path.join(nodePty, 'package.json'), '{}')
    fs.writeFileSync(path.join(nodePty, 'lib', 'index.js'), '')
    fs.writeFileSync(path.join(nodePty, 'prebuilds', 'linux-arm64', 'pty.node'), 'native')
    const helper = path.join(nodePty, 'prebuilds', 'linux-arm64', 'spawn-helper')
    fs.writeFileSync(helper, 'helper')
    fs.chmodSync(helper, 0o644)

    const packaged = findPackagedApplication(releaseRoot, 'linux', 'arm64')
    assert.throws(() => validatePackagedLayout(packaged, 'linux', 'arm64'), /spawn-helper.*executable/i)
  } finally {
    fs.rmSync(releaseRoot, { recursive: true, force: true })
  }
})
