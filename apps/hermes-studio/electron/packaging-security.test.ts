// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(path.join(studioRoot, 'package.json'), 'utf8')) as {
  build?: { mac?: Record<string, unknown> }
}

describe('macOS packaging security', () => {
  it('enables hardened runtime and references Studio-owned entitlement files', () => {
    expect(manifest.build?.mac).toMatchObject({
      hardenedRuntime: true,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    })
  })

  it.each([
    ['build/entitlements.mac.plist'],
    ['build/entitlements.mac.inherit.plist'],
  ])('%s grants only the native capabilities required by Electron and microphone input', (relativePath) => {
    const plist = readFileSync(path.join(studioRoot, relativePath), 'utf8')
    for (const entitlement of [
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.device.audio-input',
    ]) {
      expect(plist).toContain(`<key>${entitlement}</key>`)
    }
    expect(plist).not.toContain('com.apple.security.network.server')
    expect(plist).not.toContain('com.apple.security.files.user-selected.read-write')
  })
})
