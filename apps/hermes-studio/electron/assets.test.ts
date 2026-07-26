// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
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
      managedSourceRoots: () => [clipboardRoot],
      sessionSourceRoots: () => [],
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
      managedSourceRoots: () => [sourceRoot],
      sessionSourceRoots: () => [],
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

  it('sweeps expired handles opportunistically and never exceeds the hard cap', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-assets-cap-'))
    let now = 100
    const registry = new AssetRegistry({ allowedRoots: () => [root], now: () => now, ttlMs: 10, maxHandles: 2 })
    for (const name of ['one.png', 'two.png', 'three.png']) writeFileSync(path.join(root, name), PNG)

    const first = await registry.issue(path.join(root, 'one.png'))
    now = 111
    await registry.issue(path.join(root, 'two.png'))
    expect(registry.size).toBe(1)
    await expect(registry.resolve(first)).rejects.toMatchObject({ code: 'ASSET_HANDLE_INVALID' })

    await registry.issue(path.join(root, 'three.png'))
    await registry.issue(path.join(root, 'one.png'))
    expect(registry.size).toBe(2)
  })

  it('invalidates a handle when its file is swapped after descriptor open', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-assets-race-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-assets-race-outside-'))
    const imagePath = path.join(root, 'image.png')
    const outsidePath = path.join(outside, 'outside.png')
    writeFileSync(imagePath, PNG)
    writeFileSync(outsidePath, Buffer.concat([PNG, Buffer.from('outside')]))
    let opens = 0
    const registry = new AssetRegistry({
      allowedRoots: () => [root],
      hooks: {
        afterOpen: () => {
          opens += 1
          if (opens !== 2) return
          renameSync(imagePath, `${imagePath}.original`)
          symlinkSync(outsidePath, imagePath)
        },
      },
    })
    const url = await registry.issue(imagePath)

    await expect(registry.resolve(url)).rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
  })

  it('reads protocol bytes from the verified descriptor and fails closed on a path swap', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-protocol-race-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-protocol-race-outside-'))
    const imagePath = path.join(root, 'image.png')
    const outsidePath = path.join(outside, 'outside.png')
    writeFileSync(imagePath, PNG)
    writeFileSync(outsidePath, Buffer.concat([PNG, Buffer.from('outside')]))
    let opens = 0
    const registry = new AssetRegistry({
      allowedRoots: () => [root],
      hooks: {
        afterOpen: () => {
          opens += 1
          if (opens !== 2) return
          renameSync(imagePath, `${imagePath}.original`)
          symlinkSync(outsidePath, imagePath)
        },
      },
    })
    const url = await registry.issue(imagePath)

    await expect(createAssetProtocolResponse(url, registry))
      .rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
  })

  it('copies session images from a verified descriptor and rejects a source swap', async () => {
    const hermesHome = mkdtempSync(path.join(tmpdir(), 'studio-session-race-home-'))
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-session-race-source-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-session-race-outside-'))
    const source = path.join(sourceRoot, 'source.png')
    const outsidePath = path.join(outside, 'outside.png')
    writeFileSync(source, PNG)
    writeFileSync(outsidePath, Buffer.concat([PNG, Buffer.from('outside')]))
    const registry = new AssetRegistry({ allowedRoots: () => [hermesHome] })
    const store = new SessionAssetStore({
      hermesHome,
      registry,
      managedSourceRoots: () => [sourceRoot],
      sessionSourceRoots: () => [],
      validateImage: () => true,
      hooks: {
        afterOpen: ({ purpose }) => {
          if (purpose !== 'session-asset-source') return
          renameSync(source, `${source}.original`)
          symlinkSync(outsidePath, source)
        },
      },
    })

    await expect(store.persist('desktop_1', source))
      .rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
  })

  it('authorizes workspace source roots for only the matching session', async () => {
    const hermesHome = mkdtempSync(path.join(tmpdir(), 'studio-session-isolation-home-'))
    const managed = mkdtempSync(path.join(tmpdir(), 'studio-session-isolation-managed-'))
    const workspaceOne = mkdtempSync(path.join(tmpdir(), 'studio-session-isolation-one-'))
    const workspaceTwo = mkdtempSync(path.join(tmpdir(), 'studio-session-isolation-two-'))
    const managedImage = path.join(managed, 'managed.png')
    const imageOne = path.join(workspaceOne, 'one.png')
    const imageTwo = path.join(workspaceTwo, 'two.png')
    for (const image of [managedImage, imageOne, imageTwo]) writeFileSync(image, PNG)
    const registry = new AssetRegistry({ allowedRoots: () => [hermesHome] })
    const roots = new Map([['session-one', [workspaceOne]], ['session-two', [workspaceTwo]]])
    const store = new SessionAssetStore({
      hermesHome,
      registry,
      managedSourceRoots: () => [managed],
      sessionSourceRoots: (sessionId) => roots.get(sessionId) ?? [],
      validateImage: () => true,
    })

    await expect(store.persist('session-one', imageTwo)).rejects.toMatchObject({ code: 'ASSET_SOURCE_NOT_ALLOWED' })
    await expect(store.persist('session-one', imageOne)).resolves.toMatchObject({ path: expect.any(String) })
    await expect(store.persist('session-two', managedImage)).resolves.toMatchObject({ path: expect.any(String) })
  })

  it('validates persisted image bytes with the canonical sniffer instead of an injected decoder', async () => {
    const hermesHome = mkdtempSync(path.join(tmpdir(), 'studio-session-sniffer-home-'))
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-session-sniffer-source-'))
    const fakePng = path.join(sourceRoot, 'fake.png')
    writeFileSync(fakePng, Buffer.from('not-a-png'))
    const registry = new AssetRegistry({ allowedRoots: () => [hermesHome] })
    const store = new SessionAssetStore({
      hermesHome,
      registry,
      managedSourceRoots: () => [sourceRoot],
      sessionSourceRoots: () => [],
      validateImage: () => true,
    })

    await expect(store.persist('desktop_1', fakePng)).rejects.toMatchObject({ code: 'ASSET_IMAGE_INVALID' })
  })

  it('persists TIFF and serves its MIME type from the canonical image table', async () => {
    const hermesHome = mkdtempSync(path.join(tmpdir(), 'studio-session-tiff-home-'))
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-session-tiff-source-'))
    const tiff = path.join(sourceRoot, 'scan.tiff')
    writeFileSync(tiff, Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
    const registry = new AssetRegistry({ allowedRoots: () => [hermesHome] })
    const store = new SessionAssetStore({
      hermesHome,
      registry,
      managedSourceRoots: () => [sourceRoot],
      sessionSourceRoots: () => [],
      validateImage: () => false,
    })

    const asset = await store.persist('desktop_1', tiff)
    const response = await createAssetProtocolResponse(asset.url, registry)

    expect(response.headers.get('content-type')).toBe('image/tiff')
  })
})
