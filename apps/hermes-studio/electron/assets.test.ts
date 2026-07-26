// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AssetRegistry, SessionAssetStore, createAssetProtocolResponse } from './assets.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

describe('opaque Studio assets', () => {
  it('issues unguessable URLs that contain no real path and expire', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-assets-'))
    const imagePath = path.join(root, 'image.png')
    writeFileSync(imagePath, PNG)
    let now = 1_000
    const registry = new AssetRegistry({ allowedRoots: () => [root], now: () => now, ttlMs: 500 })

    const url = await registry.issue(imagePath)
    expect(url).toMatch(/^hermes-studio-asset:\/\/asset\/[A-Za-z0-9_-]{32,}$/)
    expect(url).not.toContain(root)
    expect(await registry.resolve(url)).toBe(realpathSync(imagePath))
    await expect(registry.resolve(url.replace(/.$/, 'x'))).rejects.toMatchObject({ code: 'ASSET_HANDLE_INVALID' })

    now = 1_501
    await expect(registry.resolve(url)).rejects.toMatchObject({ code: 'ASSET_HANDLE_EXPIRED' })
  })

  it('re-checks canonical containment when a handle is resolved', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-assets-root-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-assets-outside-'))
    const imagePath = path.join(root, 'image.png')
    writeFileSync(imagePath, PNG)
    let roots = [root]
    const registry = new AssetRegistry({ allowedRoots: () => roots })
    const url = await registry.issue(imagePath)

    roots = [outside]
    await expect(registry.resolve(url)).rejects.toMatchObject({ code: 'ASSET_PATH_NOT_ALLOWED' })
  })

  it('persists supported session images and signs their opaque URL', async () => {
    const hermesHome = mkdtempSync(path.join(tmpdir(), 'studio-session-assets-'))
    const clipboardRoot = mkdtempSync(path.join(tmpdir(), 'studio-clipboard-'))
    const source = path.join(clipboardRoot, 'clip.png')
    writeFileSync(source, PNG)
    const registry = new AssetRegistry({ allowedRoots: () => [hermesHome, clipboardRoot] })
    const store = new SessionAssetStore({
      hermesHome,
      registry,
      sourceRoots: () => [clipboardRoot],
      validateImage: async () => true,
    })

    const asset = await store.persist('desktop_session-1', source)

    expect(asset.path).toContain(path.join('sessions', 'desktop_session-1', 'assets'))
    expect(readFileSync(asset.path)).toEqual(PNG)
    expect(asset.url).not.toContain(asset.path)
    await expect(store.persist('../../escape', source)).rejects.toMatchObject({ code: 'INVALID_SESSION_ID' })
  })

  it('serves only resolved handles with no-store and nosniff headers', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-asset-protocol-'))
    const imagePath = path.join(root, 'image.png')
    writeFileSync(imagePath, PNG)
    const registry = new AssetRegistry({ allowedRoots: () => [root] })
    const url = await registry.issue(imagePath)

    const response = await createAssetProtocolResponse(url, registry)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG)
    await expect(createAssetProtocolResponse('hermes-studio-asset://asset/forged', registry)).rejects.toMatchObject({ code: 'ASSET_HANDLE_INVALID' })
  })

  it('rejects a symlinked session destination before copying outside Hermes Home', async () => {
    const hermesHome = mkdtempSync(path.join(tmpdir(), 'studio-session-link-home-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-session-link-outside-'))
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-session-link-source-'))
    const source = path.join(sourceRoot, 'clip.png')
    writeFileSync(source, PNG)
    mkdirSync(path.join(hermesHome, 'sessions'))
    symlinkSync(outside, path.join(hermesHome, 'sessions', 'desktop_1'))
    const registry = new AssetRegistry({ allowedRoots: () => [hermesHome, sourceRoot] })
    const store = new SessionAssetStore({
      hermesHome,
      registry,
      sourceRoots: () => [sourceRoot],
      validateImage: () => true,
    })

    await expect(store.persist('desktop_1', source)).rejects.toMatchObject({ code: 'ASSET_DESTINATION_NOT_ALLOWED' })
    expect(existsSync(path.join(outside, 'assets'))).toBe(false)
  })

  it('never relies on predictable random material', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-assets-random-'))
    const imagePath = path.join(root, 'image.png')
    writeFileSync(imagePath, PNG)
    const randomBytes = vi.fn()
      .mockReturnValueOnce(Buffer.alloc(32, 1))
      .mockReturnValueOnce(Buffer.alloc(32, 2))
    const registry = new AssetRegistry({ allowedRoots: () => [root], randomBytes })

    expect(await registry.issue(imagePath)).not.toBe(await registry.issue(imagePath))
  })
})
