import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { INTERNAL_BUILD_MARKER, writePackagingMarker } from './after-pack.mjs'
import {
  appleNotaryCredentials,
  redactCommandFailure,
  resolveAppleApiKey,
  verifyWindowsSignatures,
  windowsExecutablePaths,
} from './after-sign.mjs'

test('selects a keychain profile or complete API-key notarization credentials', () => {
  assert.deepEqual(
    appleNotaryCredentials({ APPLE_NOTARY_PROFILE: 'studio-profile' }),
    { kind: 'profile', profile: 'studio-profile' },
  )
  assert.deepEqual(
    appleNotaryCredentials({
      APPLE_API_KEY: '/secure/AuthKey.p8',
      APPLE_API_KEY_ID: 'KEYID',
      APPLE_API_ISSUER: 'ISSUER',
    }),
    { kind: 'api-key', key: '/secure/AuthKey.p8', keyId: 'KEYID', issuer: 'ISSUER' },
  )
  assert.equal(appleNotaryCredentials({}), null)
  assert.throws(
    () => appleNotaryCredentials({ APPLE_API_KEY_ID: 'partial' }),
    /all three apple api notarization values/i,
  )
})

test('materializes inline Apple API keys privately and removes them', () => {
  const key = resolveAppleApiKey('-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----')
  try {
    assert.equal(fs.existsSync(key.path), true)
    assert.equal(fs.statSync(key.path).mode & 0o777, 0o600)
  } finally {
    key.cleanup()
  }
  assert.equal(fs.existsSync(key.path), false)
})

test('redacts signing credentials from command failures', () => {
  const message = redactCommandFailure(
    'notarytool rejected KEYID ISSUER /tmp/private-key.p8',
    ['KEYID', 'ISSUER', '/tmp/private-key.p8'],
  )
  assert.equal(message.includes('KEYID'), false)
  assert.equal(message.includes('ISSUER'), false)
  assert.equal(message.includes('/tmp/private-key.p8'), false)
  assert.match(message, /\[REDACTED\]/)
})

test('writes an explicit marker for an unsigned package and removes it for release', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-signing-'))
  const context = { electronPlatformName: 'linux', appOutDir: root, packager: {} }
  try {
    const internal = writePackagingMarker(context, {})
    assert.equal(path.basename(internal), INTERNAL_BUILD_MARKER)
    assert.match(fs.readFileSync(internal, 'utf8'), /not approved for public distribution/i)

    const releaseContext = { electronPlatformName: 'win32', appOutDir: root, packager: {} }
    writePackagingMarker(releaseContext, {
      HERMES_STUDIO_RELEASE: '1',
      WIN_CSC_LINK: 'certificate',
    })
    assert.equal(fs.existsSync(path.join(root, 'resources', INTERNAL_BUILD_MARKER)), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('recursively verifies every packaged Windows executable and excludes DLLs by policy', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-studio-windows-signing-'))
  const main = path.join(root, 'Hermes Studio.exe')
  const sidecar = path.join(root, 'resources', 'sidecar', 'daemon.exe')
  const winpty = path.join(root, 'resources', 'app.asar.unpacked', 'dist', 'node_modules', 'node-pty', 'winpty-agent.exe')
  const helper = path.join(root, 'resources', 'nested', 'OpenConsole.EXE')
  const dll = path.join(root, 'resources', 'app.asar.unpacked', 'dist', 'node_modules', 'node-pty', 'winpty.dll')
  for (const file of [main, sidecar, winpty, helper, dll]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '')
  }
  try {
    assert.deepEqual(windowsExecutablePaths(root), [main, helper, sidecar, winpty].sort())
    let invocation
    await verifyWindowsSignatures(
      { appOutDir: root, packager: { appInfo: { productFilename: 'Hermes Studio' } } },
      async (command, args) => { invocation = { command, args } },
    )
    assert.equal(invocation.command, 'powershell.exe')
    assert.deepEqual(invocation.args.slice(4), [main, helper, sidecar, winpty].sort())
    assert.equal(invocation.args.includes(dll), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
