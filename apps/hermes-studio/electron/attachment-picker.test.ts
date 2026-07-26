// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AttachmentStagingService,
  IMAGE_ATTACHMENT_EXTENSIONS,
  IMAGE_ATTACHMENT_FILTERS,
} from './attachment-picker.js'
import { AssetRegistry, SessionAssetStore } from './assets.js'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

describe('AttachmentStagingService', () => {
  it('exports a fixed image filter and stages selected images in the managed root', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-managed-'))
    const source = path.join(sourceRoot, 'photo.png')
    writeFileSync(source, PNG)
    const staging = new AttachmentStagingService({ managedRoot })

    const selected = await staging.selectAttachments(
      { sessionId: 'session-one', kind: 'image', multiple: false },
      async ({ filters }) => {
        expect(filters).toEqual(IMAGE_ATTACHMENT_FILTERS)
        return [source]
      },
    )

    expect(IMAGE_ATTACHMENT_EXTENSIONS).toContain('png')
    expect(selected).toHaveLength(1)
    expect(selected[0]).toContain(realpathSync(managedRoot))
    expect(selected[0]).toContain('session-one')
    expect(selected[0]).not.toBe(source)
    expect(readFileSync(selected[0])).toEqual(PNG)
  })

  it('returns canonical files and folders without staging and honors cancellation', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-attachment-canonical-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-canonical-managed-'))
    const file = path.join(root, 'note.txt')
    writeFileSync(file, 'note')
    const staging = new AttachmentStagingService({ managedRoot })

    await expect(staging.selectAttachments({ sessionId: 'session-one', kind: 'file', multiple: false }, async () => [file]))
      .resolves.toEqual([realpathSync(file)])
    await expect(staging.selectAttachments({ sessionId: 'session-one', kind: 'folder', multiple: false }, async () => [root]))
      .resolves.toEqual([realpathSync(root)])
    await expect(staging.selectAttachments({ sessionId: 'session-one', kind: 'image', multiple: false }, async () => undefined))
      .resolves.toEqual([])
  })

  it('rejects unsupported image types, oversized images, and multiple results for a single selection', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-invalid-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-invalid-managed-'))
    const text = path.join(sourceRoot, 'not-image.txt')
    const huge = path.join(sourceRoot, 'huge.png')
    writeFileSync(text, 'not an image')
    writeFileSync(huge, Buffer.alloc(17))
    const staging = new AttachmentStagingService({ managedRoot, maxImageBytes: 16 })

    await expect(staging.selectAttachments({ sessionId: 'session-one', kind: 'image', multiple: false }, async () => [text]))
      .rejects.toMatchObject({ code: 'ASSET_TYPE_NOT_ALLOWED' })
    await expect(staging.selectAttachments({ sessionId: 'session-one', kind: 'image', multiple: false }, async () => [huge]))
      .rejects.toMatchObject({ code: 'ASSET_TOO_LARGE' })
    await expect(staging.selectAttachments({ sessionId: 'session-one', kind: 'file', multiple: false }, async () => [text, huge]))
      .rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_SELECTION' })
  })

  it('fails closed when an image path is swapped after descriptor open', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-race-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-attachment-race-outside-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-race-managed-'))
    const source = path.join(sourceRoot, 'photo.png')
    const outsidePath = path.join(outside, 'outside.png')
    writeFileSync(source, PNG)
    writeFileSync(outsidePath, Buffer.concat([PNG, Buffer.from('outside')]))
    const staging = new AttachmentStagingService({
      managedRoot,
      hooks: {
        afterOpen: ({ purpose }) => {
          if (purpose !== 'attachment-image-source') return
          renameSync(source, `${source}.original`)
          symlinkSync(outsidePath, source)
        },
      },
    })

    await expect(staging.selectAttachments({ sessionId: 'session-one', kind: 'image', multiple: false }, async () => [source]))
      .rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
    expect(existsSync(path.join(managedRoot, 'photo.png'))).toBe(false)
  })

  it('uses distinct staging roots for different sessions and rejects unsafe session ids', async () => {
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-session-root-'))
    const staging = new AttachmentStagingService({ managedRoot })

    expect(staging.sessionRoot('session-one')).not.toBe(staging.sessionRoot('session-two'))
    expect(() => staging.sessionRoot('../escape')).toThrowError(expect.objectContaining({ code: 'INVALID_SESSION_ID' }))
  })

  it('does not let another session persist a known staged image path', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-isolation-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-isolation-managed-'))
    const hermesHome = mkdtempSync(path.join(tmpdir(), 'studio-attachment-isolation-home-'))
    const source = path.join(sourceRoot, 'photo.png')
    writeFileSync(source, PNG)
    const staging = new AttachmentStagingService({ managedRoot })
    const [staged] = await staging.selectAttachments(
      { sessionId: 'session-one', kind: 'image', multiple: false },
      async () => [source],
    )
    const registry = new AssetRegistry({ allowedRoots: () => [hermesHome] })
    const store = new SessionAssetStore({
      hermesHome,
      registry,
      managedSourceRoots: () => [],
      sessionSourceRoots: (sessionId) => [staging.sessionRoot(sessionId)],
      validateImage: () => true,
    })

    await expect(store.persist('session-two', staged)).rejects.toMatchObject({ code: 'ASSET_SOURCE_NOT_ALLOWED' })
    await expect(store.persist('session-one', staged)).resolves.toMatchObject({ path: expect.any(String) })
  })

  it('revokes all staged attachment paths on native shutdown', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-clear-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-clear-managed-'))
    const source = path.join(sourceRoot, 'photo.png')
    writeFileSync(source, PNG)
    const staging = new AttachmentStagingService({ managedRoot })
    const [staged] = await staging.selectAttachments(
      { sessionId: 'session-one', kind: 'image', multiple: false },
      async () => [source],
    )

    expect(existsSync(staged)).toBe(true)
    await staging.clear()
    expect(existsSync(staged)).toBe(false)
  })
})
