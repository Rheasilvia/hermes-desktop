// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync(path.join(studioRoot, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
  build?: {
    electronVersion?: string
    artifactName?: string
    icon?: string
    beforePack?: string
    afterPack?: string
    afterSign?: string
    asarUnpack?: string[]
    extraResources?: Array<Record<string, unknown>>
    mac?: Record<string, unknown>
    win?: Record<string, unknown>
    linux?: Record<string, unknown>
    deb?: Record<string, unknown>
    rpm?: Record<string, unknown>
  }
}

describe('native package contract', () => {
  it('builds renderer assets from the Studio origin root for SPA deep-link reloads', () => {
    const viteConfig = readFileSync(path.join(studioRoot, 'vite.config.ts'), 'utf8')
    expect(viteConfig).toMatch(/base:\s*['"]\/['"]/)
    expect(viteConfig).not.toMatch(/base:\s*['"]\.\/['"]/)
  })

  it('pins Electron and stages node-pty through target-aware package hooks', () => {
    expect(manifest.devDependencies?.electron).toBe('40.10.2')
    expect(manifest.devDependencies?.['electron-builder']).toBe('26.8.1')
    expect(manifest.devDependencies?.['@electron/rebuild']).toBe('^4.0.6')
    expect(manifest.build).toMatchObject({
      electronVersion: '40.10.2',
      icon: 'build/assets/icon',
      beforePack: 'scripts/before-pack.mjs',
      afterPack: 'scripts/after-pack.mjs',
      afterSign: 'scripts/after-sign.mjs',
      artifactName: 'Hermes-Studio-${version}-${os}-${arch}.${ext}',
    })
    expect(manifest.build?.asarUnpack).toContain('dist/node_modules/node-pty/**')
    const resolvedBuilder = JSON.parse(readFileSync(require.resolve('electron-builder/package.json'), 'utf8')) as { version: string }
    expect(resolvedBuilder.version).toBe('26.8.1')
  })

  it('packages the host-native sidecar and all required platform targets', () => {
    expect(manifest.build?.extraResources).toContainEqual({
      from: 'sidecar/dist/electron',
      to: 'sidecar',
      filter: ['daemon', 'daemon.exe'],
    })
    expect(manifest.build?.mac).toMatchObject({
      target: ['dmg'],
      binaries: ['Contents/Resources/sidecar/daemon'],
    })
    expect(manifest.build?.win).toMatchObject({ target: ['nsis'] })
    expect(manifest.build?.linux).toMatchObject({ target: ['AppImage', 'deb', 'rpm'] })
    expect(manifest.build?.deb).toMatchObject({ packageName: 'hermes-studio' })
    expect(manifest.build?.rpm).toMatchObject({ packageName: 'hermes-studio' })
  })

  it('exposes quality, platform distribution, and packaged-smoke commands', () => {
    expect(manifest.scripts).toMatchObject({
      check: 'npm run typecheck && npm run lint && npm test && npm run docs:check',
      'docs:check': 'node scripts/check-docs.mjs',
      'dist:mac': expect.stringContaining('--mac dmg'),
      'dist:win': expect.stringContaining('--win nsis'),
      'dist:linux': expect.stringContaining('--linux AppImage deb rpm'),
      'test:packaged': expect.stringContaining('test:packaged:existing'),
      'test:packaged:existing': 'node scripts/packaged-smoke.mjs',
    })
  })
})

describe('macOS packaging security', () => {
  it('enables hardened runtime and references Studio-owned entitlement files', () => {
    expect(manifest.build?.mac).toMatchObject({
      notarize: false,
      hardenedRuntime: true,
      entitlements: 'build/entitlements.mac.plist',
      entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    })
  })

  it('disables electron-builder notarization so only the audited afterSign hook submits', () => {
    expect(manifest.build?.mac?.notarize).toBe(false)
    expect(manifest.build?.afterSign).toBe('scripts/after-sign.mjs')
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
