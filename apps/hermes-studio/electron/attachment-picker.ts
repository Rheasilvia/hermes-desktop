import { randomBytes as nodeRandomBytes } from 'node:crypto'
import { mkdir, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AttachmentSelectionOptions } from '../src/shared/native-bridge.js'
import { nativeError } from './native-errors.js'
import {
  canonicalizeExistingSelection,
  readVerifiedFile,
  type SafeFileHooks,
  writeVerifiedExclusiveFile,
} from './safe-file-access.js'
import { isPathInside } from './validation.js'

const DEFAULT_MAX_IMAGE_BYTES = 32 * 1024 * 1024

export const IMAGE_ATTACHMENT_EXTENSIONS = Object.freeze([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
] as const)

export const IMAGE_ATTACHMENT_FILTERS = Object.freeze([
  Object.freeze({ name: 'Images', extensions: IMAGE_ATTACHMENT_EXTENSIONS }),
])

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
  randomBytes?: (size: number) => Buffer
  hooks?: SafeFileHooks
}

function safeSessionId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(value)) {
    throw nativeError('INVALID_SESSION_ID', 'sessionId contains unsupported characters')
  }
  return value
}

function hasImageSignature(bytes: Buffer, extension: string): boolean {
  if (extension === '.png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (extension === '.jpg' || extension === '.jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (extension === '.gif') return bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a'
  if (extension === '.webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  if (extension === '.bmp') return bytes.subarray(0, 2).toString('ascii') === 'BM'
  if (extension === '.ico') return bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0
  return false
}

export class AttachmentStagingService {
  readonly managedRoot: string
  readonly #maxImageBytes: number
  readonly #randomBytes: (size: number) => Buffer
  readonly #hooks: SafeFileHooks | undefined

  constructor(options: AttachmentStagingServiceOptions) {
    this.managedRoot = path.resolve(options.managedRoot)
    this.#maxImageBytes = options.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes
    this.#hooks = options.hooks
  }

  sessionRoot(sessionId: string): string {
    return path.join(this.managedRoot, safeSessionId(sessionId))
  }

  async clear(): Promise<void> {
    await rm(this.managedRoot, { recursive: true, force: true })
  }

  async selectAttachments(
    request: AttachmentSelectionOptions,
    pickPaths: AttachmentPathPicker,
  ): Promise<string[]> {
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
      return Promise.all(selected.map((selection) => canonicalizeExistingSelection(selection, kind)))
    }

    const destinationRoot = await this.#ensureSessionRoot(sessionId)
    const staged: string[] = []
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
      if (!hasImageSignature(verified.bytes, verified.extension)) {
        throw nativeError('ASSET_IMAGE_INVALID', 'Selected image signature does not match its file type')
      }
      const destination = path.join(
        destinationRoot,
        `${Date.now()}-${this.#randomBytes(16).toString('hex')}${verified.extension}`,
      )
      staged.push(await writeVerifiedExclusiveFile(destination, verified.bytes, {
        allowedRoot: this.managedRoot,
        maxBytes: this.#maxImageBytes,
        purpose: 'attachment-image-destination',
        hooks: this.#hooks,
      }))
    }
    return staged
  }

  async #ensureSessionRoot(sessionId: string): Promise<string> {
    await mkdir(this.managedRoot, { recursive: true, mode: 0o700 })
    const canonicalManagedRoot = await realpath(this.managedRoot)
    const sessionRoot = path.join(canonicalManagedRoot, safeSessionId(sessionId))
    try {
      await mkdir(sessionRoot, { mode: 0o700 })
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
    return canonicalSessionRoot
  }
}

export async function selectAttachments(
  service: AttachmentStagingService,
  request: AttachmentSelectionOptions,
  pickPaths: AttachmentPathPicker,
): Promise<string[]> {
  return service.selectAttachments(request, pickPaths)
}
