import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  archName,
  cleanStaleAppOutDir,
  packagingDisposition,
  validateHostNativeTarget,
} from './before-pack.mjs'

test('maps electron-builder architecture values without guessing', () => {
  assert.equal(archName(0), 'ia32')
  assert.equal(archName(1), 'x64')
  assert.equal(archName(3), 'arm64')
  assert.equal(archName(4), 'universal')
  assert.throws(() => archName(99), /unsupported electron-builder architecture/i)
})

test('accepts only the exact host platform and architecture for a native sidecar', () => {
  assert.doesNotThrow(() => validateHostNativeTarget('darwin', 'arm64', 'darwin', 'arm64'))
  assert.throws(() => validateHostNativeTarget('linux', 'arm64', 'darwin', 'arm64'), /host-native sidecar/i)
  assert.throws(() => validateHostNativeTarget('darwin', 'x64', 'darwin', 'arm64'), /host-native sidecar/i)
  assert.throws(() => validateHostNativeTarget('darwin', 'universal', 'darwin', 'arm64'), /universal/i)
})

test('cleans a stale unpacked target before electron-builder writes it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-before-pack-'))
  const output = path.join(root, 'mac-arm64')
  fs.mkdirSync(output)
  fs.writeFileSync(path.join(output, 'stale'), 'stale')
  try {
    assert.equal(cleanStaleAppOutDir(output), true)
    assert.equal(fs.existsSync(output), false)
    assert.equal(cleanStaleAppOutDir(output), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('marks unsigned packages internal and recognizes configured platform signing', () => {
  assert.deepEqual(packagingDisposition('darwin', {}), { channel: 'internal', signed: false })
  assert.deepEqual(packagingDisposition('win32', {}), { channel: 'internal', signed: false })
  assert.deepEqual(packagingDisposition('linux', {}), { channel: 'internal', signed: false })
  assert.deepEqual(packagingDisposition('darwin', { CSC_LINK: 'certificate' }), { channel: 'internal', signed: true })
  assert.deepEqual(packagingDisposition('darwin', {
    HERMES_STUDIO_RELEASE: '1',
    CSC_LINK: 'certificate',
    APPLE_NOTARY_PROFILE: 'hermes-studio',
  }), { channel: 'release', signed: true })
  assert.deepEqual(packagingDisposition('win32', {
    WIN_CSC_LINK: 'certificate',
  }), { channel: 'internal', signed: true })
  assert.deepEqual(packagingDisposition('win32', {
    HERMES_STUDIO_RELEASE: '1',
    WIN_CSC_LINK: 'certificate',
  }), { channel: 'release', signed: true })
  assert.deepEqual(packagingDisposition('linux', {
    HERMES_STUDIO_RELEASE: '1',
  }), { channel: 'release', signed: false })
  assert.deepEqual(packagingDisposition('darwin', {
    HERMES_STUDIO_RELEASE: '1',
    CSC_LINK: 'certificate',
  }), { channel: 'internal', signed: true })
})
