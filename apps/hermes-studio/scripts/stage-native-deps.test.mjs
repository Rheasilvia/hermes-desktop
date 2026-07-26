import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  classifyNativeBinary,
  stageNodePtyInto,
} from './stage-native-deps.mjs'

const MAGIC = {
  darwin: Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0]),
  linux: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0]),
  win32: Buffer.from([0x4d, 0x5a, 0, 0, 0, 0]),
}

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-native-'))
}

function writeNative(file, platform) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, MAGIC[platform])
}

function makeNodePty(root) {
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ main: 'lib/index.js' }))
  fs.writeFileSync(path.join(root, 'lib', 'index.js'), 'module.exports = {}')
  fs.writeFileSync(
    path.join(root, 'lib', 'unixTerminal.js'),
    [
      "helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');",
      "helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');",
    ].join('\n'),
  )
}

test('classifies the native formats that can be packaged', () => {
  const root = temporaryDirectory()
  try {
    for (const platform of ['darwin', 'linux', 'win32']) {
      const file = path.join(root, `${platform}.node`)
      writeNative(file, platform)
      assert.equal(classifyNativeBinary(file), platform)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('stages only the requested prebuild and makes spawn-helper executable', async () => {
  const root = temporaryDirectory()
  try {
    const source = path.join(root, 'node-pty')
    const destination = path.join(root, 'dist', 'node_modules', 'node-pty')
    makeNodePty(source)
    const requested = path.join(source, 'prebuilds', 'darwin-arm64')
    writeNative(path.join(requested, 'pty.node'), 'darwin')
    fs.writeFileSync(path.join(requested, 'spawn-helper'), 'helper')
    fs.chmodSync(path.join(requested, 'spawn-helper'), 0o644)
    writeNative(path.join(source, 'prebuilds', 'darwin-x64', 'pty.node'), 'darwin')
    writeNative(path.join(source, 'build', 'Release', 'pty.node'), 'linux')

    await stageNodePtyInto(source, destination, {
      platform: 'darwin',
      arch: 'arm64',
      hostPlatform: 'linux',
      hostArch: 'x64',
    })

    assert.equal(fs.existsSync(path.join(destination, 'prebuilds', 'darwin-arm64', 'pty.node')), true)
    assert.equal(fs.existsSync(path.join(destination, 'prebuilds', 'darwin-x64')), false)
    assert.equal(fs.existsSync(path.join(destination, 'build', 'Release')), false)
    assert.equal(fs.statSync(path.join(destination, 'prebuilds', 'darwin-arm64', 'spawn-helper')).mode & 0o777, 0o755)
    const unixTerminal = fs.readFileSync(path.join(destination, 'lib', 'unixTerminal.js'), 'utf8')
    assert.match(unixTerminal, /app\\\.asar\(\?!\\\.unpacked\)/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rebuilds an exact host target when no matching prebuild exists', async () => {
  const root = temporaryDirectory()
  try {
    const source = path.join(root, 'node-pty')
    const destination = path.join(root, 'stage')
    makeNodePty(source)
    let rebuiltFor

    await stageNodePtyInto(source, destination, {
      platform: 'linux',
      arch: 'arm64',
      hostPlatform: 'linux',
      hostArch: 'arm64',
      rebuild: async ({ arch }) => {
        rebuiltFor = arch
        writeNative(path.join(source, 'build', 'Release', 'pty.node'), 'linux')
        fs.writeFileSync(path.join(source, 'build', 'Release', 'spawn-helper'), 'helper')
      },
    })

    assert.equal(rebuiltFor, 'arm64')
    assert.equal(fs.existsSync(path.join(destination, 'build', 'Release', 'pty.node')), true)
    assert.equal(fs.statSync(path.join(destination, 'build', 'Release', 'spawn-helper')).mode & 0o777, 0o755)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed when a foreign target has no matching prebuild', async () => {
  const root = temporaryDirectory()
  try {
    const source = path.join(root, 'node-pty')
    makeNodePty(source)
    writeNative(path.join(source, 'build', 'Release', 'pty.node'), 'darwin')

    await assert.rejects(
      stageNodePtyInto(source, path.join(root, 'stage'), {
        platform: 'win32',
        arch: 'x64',
        hostPlatform: 'darwin',
        hostArch: 'arm64',
      }),
      /cannot cross-compile/i,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a prebuild whose native format does not match its target', async () => {
  const root = temporaryDirectory()
  try {
    const source = path.join(root, 'node-pty')
    makeNodePty(source)
    writeNative(path.join(source, 'prebuilds', 'linux-x64', 'pty.node'), 'darwin')

    await assert.rejects(
      stageNodePtyInto(source, path.join(root, 'stage'), {
        platform: 'linux',
        arch: 'x64',
        hostPlatform: 'darwin',
        hostArch: 'arm64',
      }),
      /platform mismatch/i,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
