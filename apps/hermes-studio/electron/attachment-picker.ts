import { randomBytes as nodeRandomBytes } from 'node:crypto'
import { lstat, mkdir, opendir, realpath, rename, rm, rmdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type {
  AttachmentSelectionOptions,
  DroppedFileDescriptor,
  ImportedDroppedFile,
  SelectedAttachment,
} from '../src/shared/native-bridge.js'
import {
  IMAGE_FILE_EXTENSIONS,
  IMAGE_PICKER_FILTERS,
  MAX_IMAGE_SIGNATURE_BYTES,
  isSupportedImageExtension,
  sniffImageFormat,
} from './image-formats.js'
import { NativeBridgeError, nativeError } from './native-errors.js'
import {
  canonicalizeExistingSelection,
  readVerifiedFile,
  type SafeFileHooks,
  writeVerifiedExclusiveFile,
} from './safe-file-access.js'
import { isPathInside } from './validation.js'

const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_FILES_PER_SESSION = 64
const DEFAULT_MAX_BYTES_PER_SESSION = 256 * 1024 * 1024
const DEFAULT_MAX_FILES_TOTAL = 512
const DEFAULT_MAX_BYTES_TOTAL = 1024 * 1024 * 1024
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000
const DEFAULT_MAX_SCAN_ENTRIES = 4_096
const STAGED_FILE_PATTERN = /^(\d{1,17})-[0-9a-f]{32}(\.[a-z0-9]+)$/

export const IMAGE_ATTACHMENT_EXTENSIONS = IMAGE_FILE_EXTENSIONS
export const IMAGE_ATTACHMENT_FILTERS = IMAGE_PICKER_FILTERS

const IMAGE_EXTENSION_SET = new Set<string>(IMAGE_ATTACHMENT_EXTENSIONS.map((extension) => `.${extension}`))

export interface AttachmentPickerOptions {
  kind: AttachmentSelectionOptions['kind']
  multiple: boolean
  filters?: typeof IMAGE_ATTACHMENT_FILTERS
}

export type AttachmentPathPicker = (
  options: AttachmentPickerOptions,
) => Promise<readonly string[] | undefined>

export interface AttachmentStagingServiceOptions {
  managedRoot: string
  maxImageBytes?: number
  maxFilesPerSession?: number
  maxBytesPerSession?: number
  maxFilesTotal?: number
  maxBytesTotal?: number
  maxAgeMs?: number
  maxScanEntries?: number
  now?: () => number
  randomBytes?: (size: number) => Buffer
  hooks?: SafeFileHooks
  /** Test/audit adapter for rollback cleanup. */
  removeStagedFile?: (path: string) => Promise<void>
  /** Test/audit adapter for a destination write that fails after creation. */
  writeStagedFile?: typeof writeVerifiedExclusiveFile
  reportRecoveryError?: (message: string, error: unknown) => void
}

interface StagingInventory {
  filesPerSession: number
  bytesPerSession: number
  filesTotal: number
  bytesTotal: number
}

interface SessionInventory {
  files: number
  bytes: number
}

interface StagedCandidate {
  path: string
  sessionId: string
  bytes: number
  createdAt: number
}

function isSafeSessionId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value)
}

function safeSessionId(value: unknown): string {
  if (typeof value !== 'string' || !isSafeSessionId(value)) {
    throw nativeError('INVALID_SESSION_ID', 'sessionId contains unsupported characters')
  }
  return value
}

function stagingLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 0) {
    throw nativeError('INVALID_STAGING_LIMIT', `${name} must be a non-negative safe integer`)
  }
  return resolved
}

export class AttachmentStagingService {
  readonly managedRoot: string
  readonly #maxImageBytes: number
  readonly #maxFilesPerSession: number
  readonly #maxBytesPerSession: number
  readonly #maxFilesTotal: number
  readonly #maxBytesTotal: number
  readonly #maxAgeMs: number
  readonly #maxScanEntries: number
  readonly #now: () => number
  readonly #randomBytes: (size: number) => Buffer
  readonly #hooks: SafeFileHooks | undefined
  readonly #removeStagedFile: (path: string) => Promise<void>
  readonly #writeStagedFile: typeof writeVerifiedExclusiveFile
  readonly #reportRecoveryError: (message: string, error: unknown) => void
  readonly #overflowQuarantine: string
  readonly #sessions = new Map<string, SessionInventory>()
  #filesTotal = 0
  #bytesTotal = 0
  #initialized = false
  #closed = false
  #closePromise: Promise<void> | undefined
  #operationTail: Promise<void> = Promise.resolve()

  constructor(options: AttachmentStagingServiceOptions) {
    this.managedRoot = path.resolve(options.managedRoot)
    if (this.managedRoot === path.parse(this.managedRoot).root) {
      throw nativeError('ASSET_DESTINATION_NOT_ALLOWED', 'Attachment staging root may not be a filesystem root')
    }
    this.#maxImageBytes = stagingLimit(options.maxImageBytes, DEFAULT_MAX_IMAGE_BYTES, 'maxImageBytes')
    this.#maxFilesPerSession = stagingLimit(options.maxFilesPerSession, DEFAULT_MAX_FILES_PER_SESSION, 'maxFilesPerSession')
    this.#maxBytesPerSession = stagingLimit(options.maxBytesPerSession, DEFAULT_MAX_BYTES_PER_SESSION, 'maxBytesPerSession')
    this.#maxFilesTotal = stagingLimit(options.maxFilesTotal, DEFAULT_MAX_FILES_TOTAL, 'maxFilesTotal')
    this.#maxBytesTotal = stagingLimit(options.maxBytesTotal, DEFAULT_MAX_BYTES_TOTAL, 'maxBytesTotal')
    this.#maxAgeMs = stagingLimit(options.maxAgeMs, DEFAULT_MAX_AGE_MS, 'maxAgeMs')
    this.#maxScanEntries = stagingLimit(
      options.maxScanEntries,
      Math.max(DEFAULT_MAX_SCAN_ENTRIES, this.#maxFilesTotal * 2 + 256),
      'maxScanEntries',
    )
    this.#now = options.now ?? Date.now
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes
    this.#hooks = options.hooks
    this.#removeStagedFile = options.removeStagedFile ?? unlink
    this.#writeStagedFile = options.writeStagedFile ?? writeVerifiedExclusiveFile
    this.#reportRecoveryError = options.reportRecoveryError
      ?? ((message, error) => console.error(message, error))
    this.#overflowQuarantine = `${this.managedRoot}.overflow-quarantine`
  }

  sessionRoot(sessionId: string): string {
    return path.join(this.managedRoot, safeSessionId(sessionId))
  }

  initialize(): Promise<void> {
    if (this.#closed) return this.#closedRejection()
    return this.#runExclusive(() => this.#initializeRecoveringFromOverflow())
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    this.#closed = true
    this.#closePromise = this.#runExclusive(async () => undefined)
    return this.#closePromise
  }

  /** @deprecated Clean shutdown preserves valid staged drafts; use close(). */
  clear(): Promise<void> {
    return this.close()
  }

  selectAttachments(
    request: AttachmentSelectionOptions,
    pickPaths: AttachmentPathPicker,
  ): Promise<SelectedAttachment[]> {
    if (this.#closed) return this.#closedRejection()
    return this.#runExclusive(() => this.#selectAttachments(request, pickPaths))
  }

  async #selectAttachments(
    request: AttachmentSelectionOptions,
    pickPaths: AttachmentPathPicker,
  ): Promise<SelectedAttachment[]> {
    const sessionId = safeSessionId(request.sessionId)
    const multiple = request.multiple
    const selected = await pickPaths({
      kind: request.kind,
      multiple,
      ...(request.kind === 'image' ? { filters: IMAGE_ATTACHMENT_FILTERS } : {}),
    })
    if (!selected?.length) return []
    if (!multiple && selected.length > 1) {
      throw nativeError('INVALID_ATTACHMENT_SELECTION', 'Only one attachment may be selected')
    }

    const kind = request.kind
    if (kind === 'file' || kind === 'folder') {
      const canonical = await Promise.all(selected.map((selection) => canonicalizeExistingSelection(selection, kind)))
      return canonical.map((selectedPath) => ({
        kind,
        path: selectedPath,
        name: path.basename(selectedPath),
      }))
    }

    return (await this.#stageImageBatch(sessionId, selected))
      .map(({ path: stagedPath, name }) => ({ kind: 'image', path: stagedPath, name }))
  }

  importDroppedFiles(
    sessionIdValue: unknown,
    candidates: readonly DroppedFileDescriptor[],
  ): Promise<ImportedDroppedFile[]> {
    if (this.#closed) return this.#closedRejection()
    const sessionId = safeSessionId(sessionIdValue)
    return this.#runExclusive(async () => {
      const canonical = await Promise.all(candidates.map(async (candidate) => {
        const canonicalPath = await canonicalizeExistingSelection(candidate.path, 'file')
        return {
          path: canonicalPath,
          name: path.basename(canonicalPath),
          image: isSupportedImageExtension(path.extname(canonicalPath)),
        }
      }))
      const imageCandidates = canonical.filter((candidate) => candidate.image)
      const stagedImages = imageCandidates.length > 0
        ? await this.#stageImageBatch(sessionId, imageCandidates.map((candidate) => candidate.path))
        : []
      let imageIndex = 0
      return canonical.map((candidate): ImportedDroppedFile => {
        if (!candidate.image) return { kind: 'file', path: candidate.path, name: candidate.name }
        const staged = stagedImages[imageIndex++]
        if (!staged) throw nativeError('ASSET_STAGING_FAILED', 'Dropped image was not staged')
        return { kind: 'image', path: staged.path, name: candidate.name }
      })
    })
  }

  async #stageImageBatch(
    sessionId: string,
    selected: readonly string[],
  ): Promise<Array<{ path: string; name: string }>> {
    if (selected.length === 0) return []
    await this.#ensureInitialized()
    const inventory = this.#inventory(sessionId)
    const staged: Array<{ path: string; name: string }> = []
    let destinationRoot: string | undefined
    let createdSessionRoot = false
    try {
      for (const selection of selected) {
        const canonical = await canonicalizeExistingSelection(selection, 'file')
        const verified = await readVerifiedFile(canonical, {
          allowedRoots: () => [path.dirname(canonical)],
          maxBytes: this.#maxImageBytes,
          allowedExtensions: IMAGE_EXTENSION_SET,
          purpose: 'attachment-image-source',
          hooks: this.#hooks,
          errors: {
            notFound: 'ASSET_PATH_NOT_FOUND',
            outsideRoots: 'ASSET_SOURCE_NOT_ALLOWED',
            notFile: 'ASSET_PATH_INVALID',
            tooLarge: 'ASSET_TOO_LARGE',
            typeNotAllowed: 'ASSET_TYPE_NOT_ALLOWED',
          },
        })
        if (!sniffImageFormat(verified.bytes, verified.extension)) {
          throw nativeError('ASSET_IMAGE_INVALID', 'Selected image signature does not match its file type')
        }
        this.#assertCapacity(inventory, verified.bytes.byteLength)
        if (!destinationRoot) {
          const destination = await this.#ensureSessionRoot(sessionId)
          destinationRoot = destination.path
          createdSessionRoot = destination.created
        }
        const destination = path.join(
          destinationRoot,
          `${this.#now()}-${this.#randomBytes(16).toString('hex')}${verified.extension}`,
        )
        const stagedPath = await this.#writeStagedFile(destination, verified.bytes, {
          allowedRoot: this.managedRoot,
          maxBytes: this.#maxImageBytes,
          purpose: 'attachment-image-destination',
          hooks: this.#hooks,
        })
        staged.push({ path: stagedPath, name: path.basename(verified.path) })
        inventory.filesPerSession += 1
        inventory.bytesPerSession += verified.bytes.byteLength
        inventory.filesTotal += 1
        inventory.bytesTotal += verified.bytes.byteLength
      }
      this.#commitInventory(sessionId, inventory)
      return staged
    } catch (error) {
      if (destinationRoot) {
        // A secure writer can fail after creating a destination but before it
        // returns the path. Conservatively distrust all in-memory counts once
        // this batch reached the managed destination.
        this.#initialized = false
      }
      const rollback = await Promise.allSettled(
        staged.map(({ path: stagedPath }) => this.#removeStagedFile(stagedPath)),
      )
      if (rollback.some((outcome) => outcome.status === 'rejected')) {
        // A leftover is not represented by the pre-batch inventory. Force a
        // canonical disk reconstruction before any later capacity decision.
        this.#initialized = false
      }
      if (createdSessionRoot && destinationRoot) {
        await rmdir(destinationRoot).catch((removeError: NodeJS.ErrnoException) => {
          if (removeError.code !== 'ENOENT' && removeError.code !== 'ENOTEMPTY') throw removeError
        })
      }
      throw error
    }
  }

  #assertCapacity(inventory: StagingInventory, incomingBytes: number): void {
    if (
      inventory.filesPerSession + 1 > this.#maxFilesPerSession
      || inventory.bytesPerSession + incomingBytes > this.#maxBytesPerSession
      || inventory.filesTotal + 1 > this.#maxFilesTotal
      || inventory.bytesTotal + incomingBytes > this.#maxBytesTotal
    ) {
      throw nativeError('ASSET_STAGING_LIMIT_EXCEEDED', 'Attachment staging capacity has been reached')
    }
  }

  #inventory(sessionId: string): StagingInventory {
    const session = this.#sessions.get(sessionId)
    return {
      filesPerSession: session?.files ?? 0,
      bytesPerSession: session?.bytes ?? 0,
      filesTotal: this.#filesTotal,
      bytesTotal: this.#bytesTotal,
    }
  }

  #commitInventory(sessionId: string, inventory: StagingInventory): void {
    this.#sessions.set(sessionId, {
      files: inventory.filesPerSession,
      bytes: inventory.bytesPerSession,
    })
    this.#filesTotal = inventory.filesTotal
    this.#bytesTotal = inventory.bytesTotal
  }

  #closedRejection<T>(): Promise<T> {
    return Promise.reject(nativeError('ASSET_STAGING_CLOSED', 'Attachment staging is closed'))
  }

  async #ensureInitialized(): Promise<void> {
    if (!this.#initialized) await this.#initializeRecoveringFromOverflow()
  }

  async #initializeRecoveringFromOverflow(): Promise<void> {
    await this.#sweepOverflowQuarantine()
    try {
      await this.#reconstructAndPrune()
    } catch (error) {
      if (!(error instanceof NativeBridgeError) || error.code !== 'ASSET_STAGING_SCAN_LIMIT_EXCEEDED') {
        throw error
      }
      await this.#rotateOverflowedRoot()
    }
  }

  async #sweepOverflowQuarantine(): Promise<boolean> {
    try {
      await rm(this.#overflowQuarantine, { recursive: true, force: true })
      return true
    } catch (error) {
      this.#reportRecoveryError('Hermes Studio could not remove attachment staging quarantine', error)
      return false
    }
  }

  async #rotateOverflowedRoot(): Promise<void> {
    const quarantineAvailable = await this.#sweepOverflowQuarantine()
    if (!quarantineAvailable) {
      // Never allocate a second sibling when the one known quarantine cannot
      // be reclaimed. Reset in place so repeated overflow cannot grow an
      // unbounded family of forgotten directories.
      await rm(this.managedRoot, { recursive: true, force: true })
      await mkdir(this.managedRoot, { mode: 0o700 })
      this.#resetInventory()
      this.#initialized = true
      return
    }

    await rename(this.managedRoot, this.#overflowQuarantine)
    try {
      await mkdir(this.managedRoot, { mode: 0o700 })
    } catch (error) {
      await rename(this.#overflowQuarantine, this.managedRoot).catch(() => undefined)
      throw error
    }
    this.#resetInventory()
    this.#initialized = true
    // Rotation restores availability before recursive cleanup. The single
    // known slot is retried on every startup and any failure is reported.
    void this.#sweepOverflowQuarantine()
  }

  #resetInventory(): void {
    this.#sessions.clear()
    this.#filesTotal = 0
    this.#bytesTotal = 0
  }

  async #reconstructAndPrune(): Promise<void> {
    this.#initialized = false
    this.#resetInventory()
    await mkdir(this.managedRoot, { recursive: true, mode: 0o700 })
    const rootMetadata = await lstat(this.managedRoot)
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw nativeError('ASSET_DESTINATION_NOT_ALLOWED', 'Attachment staging root is not a regular directory')
    }
    const canonicalRoot = await realpath(this.managedRoot)
    const candidates: StagedCandidate[] = []
    const sessionDirectories: string[] = []
    const now = this.#now()
    let scannedEntries = 0
    const countEntry = () => {
      scannedEntries += 1
      if (scannedEntries > this.#maxScanEntries) {
        throw nativeError('ASSET_STAGING_SCAN_LIMIT_EXCEEDED', 'Attachment staging scan exceeded its hard limit')
      }
    }

    const root = await opendir(canonicalRoot)
    for await (const sessionEntry of root) {
      countEntry()
      const sessionPath = path.join(canonicalRoot, sessionEntry.name)
      if (!sessionEntry.isDirectory() || !isSafeSessionId(sessionEntry.name)) {
        await rm(sessionPath, { recursive: true, force: true })
        continue
      }

      let canonicalSession: string
      try {
        canonicalSession = await realpath(sessionPath)
        const metadata = await lstat(sessionPath)
        if (
          canonicalSession !== sessionPath
          || !metadata.isDirectory()
          || metadata.isSymbolicLink()
          || !isPathInside(canonicalRoot, canonicalSession)
        ) throw new Error('invalid staging session directory')
      } catch {
        await rm(sessionPath, { recursive: true, force: true })
        continue
      }
      sessionDirectories.push(canonicalSession)

      const session = await opendir(canonicalSession)
      for await (const fileEntry of session) {
        countEntry()
        const filePath = path.join(canonicalSession, fileEntry.name)
        const match = STAGED_FILE_PATTERN.exec(fileEntry.name)
        if (!fileEntry.isFile() || !match || !isSupportedImageExtension(match[2] ?? '')) {
          await rm(filePath, { recursive: true, force: true })
          continue
        }

        const encodedCreatedAt = Number(match[1])
        let metadata
        try {
          metadata = await lstat(filePath)
        } catch {
          continue
        }
        const createdAt = Math.min(encodedCreatedAt, metadata.mtimeMs)
        if (
          !metadata.isFile()
          || metadata.isSymbolicLink()
          || !Number.isSafeInteger(encodedCreatedAt)
          || encodedCreatedAt > now + 5 * 60_000
          || now - createdAt > this.#maxAgeMs
        ) {
          await rm(filePath, { recursive: true, force: true })
          continue
        }

        try {
          const verified = await readVerifiedFile(filePath, {
            allowedRoots: () => [canonicalSession],
            maxBytes: this.#maxImageBytes,
            allowedExtensions: IMAGE_EXTENSION_SET,
            purpose: 'attachment-staging-scan',
            readPrefixBytes: MAX_IMAGE_SIGNATURE_BYTES,
            hooks: this.#hooks,
            errors: {
              notFound: 'ASSET_PATH_NOT_FOUND',
              outsideRoots: 'ASSET_SOURCE_NOT_ALLOWED',
              notFile: 'ASSET_PATH_INVALID',
              tooLarge: 'ASSET_TOO_LARGE',
              typeNotAllowed: 'ASSET_TYPE_NOT_ALLOWED',
            },
          })
          if (!sniffImageFormat(verified.bytes, verified.extension)) {
            throw nativeError('ASSET_IMAGE_INVALID', 'Staged image signature does not match its file type')
          }
          candidates.push({
            path: verified.path,
            sessionId: sessionEntry.name,
            bytes: verified.size,
            createdAt,
          })
        } catch {
          await rm(filePath, { recursive: true, force: true })
        }
      }
    }

    candidates.sort((left, right) => right.createdAt - left.createdAt)
    for (const candidate of candidates) {
      const session = this.#sessions.get(candidate.sessionId) ?? { files: 0, bytes: 0 }
      if (
        session.files + 1 > this.#maxFilesPerSession
        || session.bytes + candidate.bytes > this.#maxBytesPerSession
        || this.#filesTotal + 1 > this.#maxFilesTotal
        || this.#bytesTotal + candidate.bytes > this.#maxBytesTotal
      ) {
        await unlink(candidate.path)
        continue
      }
      session.files += 1
      session.bytes += candidate.bytes
      this.#sessions.set(candidate.sessionId, session)
      this.#filesTotal += 1
      this.#bytesTotal += candidate.bytes
    }

    await Promise.all(sessionDirectories.map(async (directory) => {
      await rmdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error
      })
    }))
    this.#initialized = true
  }

  #runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation)
    this.#operationTail = result.then(() => undefined, () => undefined)
    return result
  }

  async #ensureSessionRoot(sessionId: string): Promise<{ path: string; created: boolean }> {
    await mkdir(this.managedRoot, { recursive: true, mode: 0o700 })
    const canonicalManagedRoot = await realpath(this.managedRoot)
    const sessionRoot = path.join(canonicalManagedRoot, safeSessionId(sessionId))
    let created = false
    try {
      await mkdir(sessionRoot, { mode: 0o700 })
      created = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const canonicalSessionRoot = await realpath(sessionRoot)
    const metadata = await stat(canonicalSessionRoot)
    if (
      canonicalSessionRoot !== sessionRoot
      || !isPathInside(canonicalManagedRoot, canonicalSessionRoot)
      || !metadata.isDirectory()
    ) {
      throw nativeError('ASSET_DESTINATION_NOT_ALLOWED', 'Attachment staging root is not allowed')
    }
    return { path: canonicalSessionRoot, created }
  }
}

export async function selectAttachments(
  service: AttachmentStagingService,
  request: AttachmentSelectionOptions,
  pickPaths: AttachmentPathPicker,
): Promise<SelectedAttachment[]> {
  return service.selectAttachments(request, pickPaths)
}
