// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
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

function droppedFile(filePath: string) {
  return {
    path: filePath,
    name: path.basename(filePath),
    type: '',
    size: statSync(filePath).size,
  }
}

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
    expect(selected).toEqual([{
      kind: 'image',
      path: expect.stringContaining('session-one'),
      name: 'photo.png',
    }])
    expect(selected[0]!.path).toContain(realpathSync(managedRoot))
    expect(selected[0]!.path).not.toBe(source)
    expect(readFileSync(selected[0]!.path)).toEqual(PNG)
  })

  it('returns canonical files and folders without staging and honors cancellation', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-attachment-canonical-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-canonical-managed-'))
    const file = path.join(root, 'note.txt')
    writeFileSync(file, 'note')
    const staging = new AttachmentStagingService({ managedRoot })

    await expect(staging.selectAttachments({ sessionId: 'session-one', kind: 'file', multiple: false }, async () => [file]))
      .resolves.toEqual([{ kind: 'file', path: realpathSync(file), name: 'note.txt' }])
    await expect(staging.selectAttachments({ sessionId: 'session-one', kind: 'folder', multiple: false }, async () => [root]))
      .resolves.toEqual([{ kind: 'folder', path: realpathSync(root), name: path.basename(root) }])
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

    await expect(store.persist('session-two', staged!.path)).rejects.toMatchObject({ code: 'ASSET_SOURCE_NOT_ALLOWED' })
    await expect(store.persist('session-one', staged!.path)).resolves.toMatchObject({ path: expect.any(String) })
  })

  it('preserves valid staged draft images during clean-shutdown cleanup', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-clear-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-clear-managed-'))
    const source = path.join(sourceRoot, 'photo.png')
    writeFileSync(source, PNG)
    const staging = new AttachmentStagingService({ managedRoot })
    const [staged] = await staging.selectAttachments(
      { sessionId: 'session-one', kind: 'image', multiple: false },
      async () => [source],
    )

    expect(existsSync(staged!.path)).toBe(true)
    await staging.close()
    expect(existsSync(staged!.path)).toBe(true)
  })

  it('closes by draining accepted operations without rescanning persistent staging', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-close-read-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-close-read-managed-'))
    const source = path.join(sourceRoot, 'draft.png')
    writeFileSync(source, PNG)
    let startupScanReads = 0
    const staging = new AttachmentStagingService({
      managedRoot,
      hooks: {
        afterOpen: ({ purpose }) => {
          if (purpose === 'attachment-staging-scan') startupScanReads += 1
        },
      },
    })
    await staging.selectAttachments(
      { sessionId: 'session-one', kind: 'image', multiple: false },
      async () => [source],
    )

    startupScanReads = 0
    await staging.close()

    expect(startupScanReads).toBe(0)
  })

  it('closes after accepted queued work and rejects new staging without opening another picker', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-close-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-close-managed-'))
    const source = path.join(sourceRoot, 'draft.png')
    writeFileSync(source, PNG)
    const staging = new AttachmentStagingService({ managedRoot })
    let releasePicker!: () => void
    const pickerReleased = new Promise<void>((resolve) => { releasePicker = resolve })
    const accepted = staging.selectAttachments(
      { sessionId: 'session-one', kind: 'image', multiple: false },
      async () => {
        await pickerReleased
        return [source]
      },
    )
    const closing = staging.close()
    let latePickerCalled = false

    await expect(staging.selectAttachments(
      { sessionId: 'session-two', kind: 'image', multiple: false },
      async () => {
        latePickerCalled = true
        return [source]
      },
    )).rejects.toMatchObject({ code: 'ASSET_STAGING_CLOSED' })
    expect(latePickerCalled).toBe(false)

    releasePicker()
    const [staged] = await accepted
    await closing
    expect(readFileSync(staged!.path)).toEqual(PNG)
  })

  it('rolls back images written by the current multi-select when a later image is invalid', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-rollback-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-rollback-managed-'))
    const first = path.join(sourceRoot, 'first.png')
    const invalid = path.join(sourceRoot, 'invalid.png')
    writeFileSync(first, PNG)
    writeFileSync(invalid, Buffer.from('not-a-png'))
    const staging = new AttachmentStagingService({ managedRoot })

    await expect(staging.selectAttachments(
      { sessionId: 'session-one', kind: 'image', multiple: true },
      async () => [first, invalid],
    )).rejects.toMatchObject({ code: 'ASSET_IMAGE_INVALID' })

    expect(existsSync(staging.sessionRoot('session-one'))).toBe(false)
  })

  it('enforces the per-session staged-file count as a hard cap', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-session-count-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-session-count-managed-'))
    const first = path.join(sourceRoot, 'first.png')
    const second = path.join(sourceRoot, 'second.png')
    writeFileSync(first, PNG)
    writeFileSync(second, PNG)
    const staging = new AttachmentStagingService({ managedRoot, maxFilesPerSession: 1 })
    await staging.selectAttachments({ sessionId: 'one', kind: 'image', multiple: false }, async () => [first])

    await expect(staging.selectAttachments(
      { sessionId: 'one', kind: 'image', multiple: false },
      async () => [second],
    )).rejects.toMatchObject({ code: 'ASSET_STAGING_LIMIT_EXCEEDED' })
    expect(readdirSync(staging.sessionRoot('one'))).toHaveLength(1)
  })

  it('enforces the total staged-file count across sessions as a hard cap', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-total-count-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-total-count-managed-'))
    const first = path.join(sourceRoot, 'first.png')
    const second = path.join(sourceRoot, 'second.png')
    writeFileSync(first, PNG)
    writeFileSync(second, PNG)
    const staging = new AttachmentStagingService({ managedRoot, maxFilesTotal: 1 })
    await staging.selectAttachments({ sessionId: 'one', kind: 'image', multiple: false }, async () => [first])

    await expect(staging.selectAttachments(
      { sessionId: 'two', kind: 'image', multiple: false },
      async () => [second],
    )).rejects.toMatchObject({ code: 'ASSET_STAGING_LIMIT_EXCEEDED' })
    expect(existsSync(staging.sessionRoot('two'))).toBe(false)
  })

  it('serializes concurrent imports so they cannot race past the total hard cap', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-concurrent-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-concurrent-managed-'))
    const first = path.join(sourceRoot, 'first.png')
    const second = path.join(sourceRoot, 'second.png')
    writeFileSync(first, PNG)
    writeFileSync(second, PNG)
    const staging = new AttachmentStagingService({ managedRoot, maxFilesTotal: 1 })

    const outcomes = await Promise.allSettled([
      staging.importDroppedFiles('one', [droppedFile(first)]),
      staging.importDroppedFiles('two', [droppedFile(second)]),
    ])

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected'])
    const stagedCount = readdirSync(managedRoot).reduce(
      (count, session) => count + readdirSync(path.join(managedRoot, session)).length,
      0,
    )
    expect(stagedCount).toBe(1)
  })

  it('enforces per-session and total staged-byte caps', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-byte-cap-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-byte-cap-managed-'))
    const first = path.join(sourceRoot, 'first.png')
    const second = path.join(sourceRoot, 'second.png')
    writeFileSync(first, PNG)
    writeFileSync(second, PNG)
    const perSession = new AttachmentStagingService({ managedRoot, maxBytesPerSession: PNG.byteLength })
    await perSession.selectAttachments({ sessionId: 'one', kind: 'image', multiple: false }, async () => [first])
    await expect(perSession.selectAttachments(
      { sessionId: 'one', kind: 'image', multiple: false },
      async () => [second],
    )).rejects.toMatchObject({ code: 'ASSET_STAGING_LIMIT_EXCEEDED' })

    const otherManagedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-total-byte-cap-managed-'))
    const total = new AttachmentStagingService({ managedRoot: otherManagedRoot, maxBytesTotal: PNG.byteLength })
    await total.selectAttachments({ sessionId: 'one', kind: 'image', multiple: false }, async () => [first])
    await expect(total.selectAttachments(
      { sessionId: 'two', kind: 'image', multiple: false },
      async () => [second],
    )).rejects.toMatchObject({ code: 'ASSET_STAGING_LIMIT_EXCEEDED' })
  })

  it('keeps a staged composer-draft image usable after a service restart', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-restart-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-restart-managed-'))
    const hermesHome = mkdtempSync(path.join(tmpdir(), 'studio-attachment-restart-home-'))
    const source = path.join(sourceRoot, 'draft.png')
    writeFileSync(source, PNG)
    const firstProcess = new AttachmentStagingService({ managedRoot })
    const [draftImage] = await firstProcess.selectAttachments(
      { sessionId: 'draft-session', kind: 'image', multiple: false },
      async () => [source],
    )

    const restartedProcess = new AttachmentStagingService({ managedRoot })
    await restartedProcess.initialize()
    const registry = new AssetRegistry({ allowedRoots: () => [hermesHome] })
    const store = new SessionAssetStore({
      hermesHome,
      registry,
      managedSourceRoots: () => [],
      sessionSourceRoots: (sessionId) => [restartedProcess.sessionRoot(sessionId)],
    })

    expect(readFileSync(draftImage!.path)).toEqual(PNG)
    await expect(store.persist('draft-session', draftImage!.path))
      .resolves.toMatchObject({ path: expect.any(String), url: expect.any(String) })
  })

  it('prunes expired and illegal crash remainders while retaining recent valid images', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-prune-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-prune-managed-'))
    const source = path.join(sourceRoot, 'draft.png')
    writeFileSync(source, PNG)
    const now = Date.now()
    const firstProcess = new AttachmentStagingService({ managedRoot })
    const [expired] = await firstProcess.selectAttachments(
      { sessionId: 'draft-session', kind: 'image', multiple: false },
      async () => [source],
    )
    const [recent] = await firstProcess.selectAttachments(
      { sessionId: 'draft-session', kind: 'image', multiple: false },
      async () => [source],
    )
    utimesSync(expired!.path, new Date(now - 20_000), new Date(now - 20_000))
    utimesSync(recent!.path, new Date(now), new Date(now))
    const illegal = path.join(firstProcess.sessionRoot('draft-session'), 'unexpected.png')
    const malformed = path.join(firstProcess.sessionRoot('draft-session'), `${now}-${'b'.repeat(32)}.png`)
    writeFileSync(illegal, PNG)
    writeFileSync(malformed, Buffer.from('not-a-png'))

    const restartedProcess = new AttachmentStagingService({
      managedRoot,
      maxAgeMs: 10_000,
      now: () => now,
    })
    await restartedProcess.initialize()

    expect(existsSync(expired!.path)).toBe(false)
    expect(existsSync(illegal)).toBe(false)
    expect(existsSync(malformed)).toBe(false)
    expect(readFileSync(recent!.path)).toEqual(PNG)
  })

  it('retains the newest valid staged images while pruning startup quota overflow', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-restart-cap-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-restart-cap-managed-'))
    const source = path.join(sourceRoot, 'draft.png')
    writeFileSync(source, PNG)
    const firstProcess = new AttachmentStagingService({ managedRoot })
    const [oldest] = await firstProcess.selectAttachments(
      { sessionId: 'draft-session', kind: 'image', multiple: false },
      async () => [source],
    )
    const [newest] = await firstProcess.selectAttachments(
      { sessionId: 'draft-session', kind: 'image', multiple: false },
      async () => [source],
    )
    const now = Date.now()
    utimesSync(oldest!.path, new Date(now - 2_000), new Date(now - 2_000))
    utimesSync(newest!.path, new Date(now - 1_000), new Date(now - 1_000))

    const restartedProcess = new AttachmentStagingService({
      managedRoot,
      maxFilesPerSession: 1,
      maxFilesTotal: 1,
      now: () => now,
    })
    await restartedProcess.initialize()

    expect(existsSync(oldest!.path)).toBe(false)
    expect(readFileSync(newest!.path)).toEqual(PNG)
  })

  it('removes illegal staged symlinks without touching their targets', async () => {
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-prune-link-managed-'))
    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-prune-link-outside-'))
    const sessionRoot = path.join(managedRoot, 'draft-session')
    const outside = path.join(outsideRoot, 'outside.png')
    const stagedLink = path.join(sessionRoot, `${Date.now()}-${'a'.repeat(32)}.png`)
    mkdirSync(sessionRoot)
    writeFileSync(outside, PNG)
    symlinkSync(outside, stagedLink)
    const staging = new AttachmentStagingService({ managedRoot })

    await staging.initialize()

    expect(existsSync(stagedLink)).toBe(false)
    expect(readFileSync(outside)).toEqual(PNG)
  })

  it('recovers from startup scan overflow by rotating the owned staging root', async () => {
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-scan-cap-managed-'))
    const sessionRoot = path.join(managedRoot, 'draft-session')
    mkdirSync(sessionRoot)
    writeFileSync(path.join(sessionRoot, 'one.invalid'), 'one')
    writeFileSync(path.join(sessionRoot, 'two.invalid'), 'two')
    const staging = new AttachmentStagingService({ managedRoot, maxScanEntries: 1 })

    await expect(staging.initialize()).resolves.toBeUndefined()
    expect(readdirSync(managedRoot)).toEqual([])
  })

  it('sweeps the single known overflow quarantine on the next startup', async () => {
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-quarantine-managed-'))
    const quarantine = `${managedRoot}.overflow-quarantine`
    mkdirSync(quarantine)
    writeFileSync(path.join(quarantine, 'crash-remnant'), 'remnant')
    const staging = new AttachmentStagingService({ managedRoot })

    await staging.initialize()

    expect(existsSync(quarantine)).toBe(false)
  })

  it('imports dropped images through staging and returns ordinary files canonically', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-drop-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-drop-managed-'))
    const image = path.join(sourceRoot, 'photo.tif')
    const note = path.join(sourceRoot, 'note.txt')
    writeFileSync(image, Buffer.from([0x49, 0x49, 0x2a, 0x00]))
    writeFileSync(note, 'note')
    const staging = new AttachmentStagingService({ managedRoot })

    const imported = await staging.importDroppedFiles('session-one', [droppedFile(image), droppedFile(note)])

    expect(imported).toEqual([
      { kind: 'image', path: expect.stringContaining('session-one'), name: 'photo.tif' },
      { kind: 'file', path: realpathSync(note), name: 'note.txt' },
    ])
    expect(readFileSync(imported[0]!.path)).toEqual(Buffer.from([0x49, 0x49, 0x2a, 0x00]))
  })

  it('does not create a staging directory when every dropped attachment is an ordinary file', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-drop-files-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-drop-files-managed-'))
    const note = path.join(sourceRoot, 'note.txt')
    writeFileSync(note, 'note')
    const staging = new AttachmentStagingService({ managedRoot })

    await expect(staging.importDroppedFiles('session-one', [droppedFile(note)]))
      .resolves.toEqual([{ kind: 'file', path: realpathSync(note), name: 'note.txt' }])
    expect(existsSync(staging.sessionRoot('session-one'))).toBe(false)
  })

  it('classifies dropped files from canonical extension and magic instead of spoofable MIME metadata', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-drop-spoof-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-drop-spoof-managed-'))
    const disguisedText = path.join(sourceRoot, 'disguised.txt')
    const invalidImage = path.join(sourceRoot, 'invalid.png')
    writeFileSync(disguisedText, PNG)
    writeFileSync(invalidImage, 'not an image')
    const staging = new AttachmentStagingService({ managedRoot })

    await expect(staging.importDroppedFiles('session-one', [{
      ...droppedFile(disguisedText),
      type: 'image/png',
    }])).resolves.toEqual([{
      kind: 'file', path: realpathSync(disguisedText), name: 'disguised.txt',
    }])
    await expect(staging.importDroppedFiles('session-one', [{
      ...droppedFile(invalidImage),
      type: 'text/plain',
    }])).rejects.toMatchObject({ code: 'ASSET_IMAGE_INVALID' })
  })

  it('rolls back staged dropped images when a later dropped image is invalid', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-drop-rollback-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-drop-rollback-managed-'))
    const first = path.join(sourceRoot, 'first.png')
    const invalid = path.join(sourceRoot, 'invalid.png')
    writeFileSync(first, PNG)
    writeFileSync(invalid, Buffer.from('invalid'))
    const staging = new AttachmentStagingService({ managedRoot })

    await expect(staging.importDroppedFiles('session-one', [droppedFile(first), droppedFile(invalid)]))
      .rejects.toMatchObject({ code: 'ASSET_IMAGE_INVALID' })
    expect(existsSync(staging.sessionRoot('session-one'))).toBe(false)
  })

  it('reconstructs inventory after a rollback unlink failure before admitting more files', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-rollback-failure-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-rollback-failure-managed-'))
    const first = path.join(sourceRoot, 'first.png')
    const invalid = path.join(sourceRoot, 'invalid.png')
    const next = path.join(sourceRoot, 'next.png')
    writeFileSync(first, PNG)
    writeFileSync(invalid, Buffer.from('invalid'))
    writeFileSync(next, PNG)
    let failOnce = true
    const staging = new AttachmentStagingService({
      managedRoot,
      maxFilesTotal: 1,
      removeStagedFile: async (stagedPath) => {
        if (failOnce) {
          failOnce = false
          throw new Error('simulated rollback unlink failure')
        }
        await unlink(stagedPath)
      },
    })

    await expect(staging.importDroppedFiles('session-one', [droppedFile(first), droppedFile(invalid)]))
      .rejects.toMatchObject({ code: 'ASSET_IMAGE_INVALID' })
    expect(readdirSync(staging.sessionRoot('session-one'))).toHaveLength(1)

    await expect(staging.importDroppedFiles('session-two', [droppedFile(next)]))
      .rejects.toMatchObject({ code: 'ASSET_STAGING_LIMIT_EXCEEDED' })
  })

  it('reconstructs inventory when a secure write fails after creating its destination', async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-write-failure-source-'))
    const managedRoot = mkdtempSync(path.join(tmpdir(), 'studio-attachment-write-failure-managed-'))
    const first = path.join(sourceRoot, 'first.png')
    const next = path.join(sourceRoot, 'next.png')
    writeFileSync(first, PNG)
    writeFileSync(next, PNG)
    let writeAttempts = 0
    const staging = new AttachmentStagingService({
      managedRoot,
      maxFilesTotal: 1,
      writeStagedFile: async (destination, bytes) => {
        writeAttempts += 1
        writeFileSync(destination, bytes)
        throw new Error('simulated post-create secure-write failure')
      },
    })

    await expect(staging.importDroppedFiles('session-one', [droppedFile(first)]))
      .rejects.toThrow('simulated post-create secure-write failure')
    expect(readdirSync(staging.sessionRoot('session-one'))).toHaveLength(1)

    await expect(staging.importDroppedFiles('session-two', [droppedFile(next)]))
      .rejects.toMatchObject({ code: 'ASSET_STAGING_LIMIT_EXCEEDED' })
    expect(writeAttempts).toBe(1)
  })
})
