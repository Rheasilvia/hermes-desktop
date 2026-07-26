import { constants, type Stats } from 'node:fs'
import { open, realpath, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { nativeError } from './native-errors.js'
import { isPathInside } from './validation.js'

export interface SafeFileHookContext {
  purpose: string
  path: string
}

/** Test and audit hooks. Production callers normally leave every hook undefined. */
export interface SafeFileHooks {
  afterOpen?: (context: SafeFileHookContext) => Promise<void> | void
  afterDirectoryRead?: (context: SafeFileHookContext) => Promise<void> | void
  beforeWriteRevalidation?: (context: SafeFileHookContext) => Promise<void> | void
  afterWriteOpen?: (context: SafeFileHookContext) => Promise<void> | void
  beforeWriteCommit?: (context: SafeFileHookContext) => Promise<void> | void
  afterWriteCommit?: (context: SafeFileHookContext) => Promise<void> | void
}

export interface FileIdentity {
  dev: number
  ino: number
}

export interface VerifiedFile {
  path: string
  bytes: Buffer
  size: number
  identity: FileIdentity
  extension: string
}

export interface VerifiedFileErrors {
  notFound?: string
  outsideRoots?: string
  notFile?: string
  tooLarge?: string
  typeNotAllowed?: string
}

export interface ReadFileHandleLike {
  stat(): Promise<Stats>
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesRead: number; buffer: Buffer }>
  close(): Promise<void>
}

export interface ReadVerifiedFileOptions {
  allowedRoots: () => readonly string[] | Promise<readonly string[]>
  maxBytes: number
  allowedExtensions?: ReadonlySet<string>
  expectedIdentity?: FileIdentity
  purpose: string
  hooks?: SafeFileHooks
  errors?: VerifiedFileErrors
  readBytes?: boolean
  /** Read only this stable prefix while still verifying the descriptor's full size and identity. */
  readPrefixBytes?: number
  /** Injectable only so bounded descriptor reads can be exercised deterministically. */
  openFile?: (path: string, flags: number) => Promise<ReadFileHandleLike>
}

export interface WriteVerifiedFileOptions {
  allowedRoot: string
  maxBytes: number
  purpose: string
  hooks?: SafeFileHooks
  mode?: number
}

const noFollowFlag = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0

function identityOf(metadata: Stats): FileIdentity {
  return { dev: metadata.dev, ino: metadata.ino }
}

export function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function changed(): never {
  throw nativeError('FILE_CHANGED_DURING_ACCESS', 'File or directory changed during secure access')
}

async function canonicalRoots(rawRoots: readonly string[]): Promise<string[]> {
  const roots = await Promise.all(rawRoots.map(async (root) => {
    try {
      return await realpath(path.resolve(root))
    } catch {
      return undefined
    }
  }))
  return roots.filter((root): root is string => root !== undefined)
}

async function assertAllowed(canonical: string, rootsProvider: ReadVerifiedFileOptions['allowedRoots'], code: string): Promise<void> {
  const rawRoots = await rootsProvider()
  const roots = await canonicalRoots(rawRoots)
  if (!roots.some((root) => isPathInside(root, canonical))) {
    throw nativeError(code, 'File path is outside the allowed roots')
  }
}

async function currentPathIdentity(canonicalPath: string): Promise<{
  canonical: string
  identity: FileIdentity
  size: number
}> {
  let rebound: string
  try {
    rebound = await realpath(canonicalPath)
  } catch {
    return changed()
  }
  if (rebound !== canonicalPath) changed()
  let metadata: Stats
  try {
    metadata = await stat(rebound)
  } catch {
    return changed()
  }
  return { canonical: rebound, identity: identityOf(metadata), size: metadata.size }
}

async function readBounded(
  handle: ReadFileHandleLike,
  maxBytes: number,
  initialSize: number,
): Promise<Buffer> {
  const maximumCapacity = maxBytes + 1
  const initialCapacity = initialSize + 1
  if (
    !Number.isSafeInteger(maximumCapacity)
    || maximumCapacity < 1
    || !Number.isSafeInteger(initialCapacity)
    || initialCapacity < 1
  ) {
    throw new RangeError('maxBytes and initialSize must be non-negative safe integers')
  }
  const capacity = Math.min(maximumCapacity, initialCapacity)
  const buffer = Buffer.allocUnsafe(capacity)
  let offset = 0
  while (offset < capacity) {
    const length = capacity - offset
    const result = await handle.read(buffer, offset, length, null)
    if (!Number.isInteger(result.bytesRead) || result.bytesRead < 0 || result.bytesRead > length) {
      return changed()
    }
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  return buffer.subarray(0, offset)
}

async function readPrefix(
  handle: ReadFileHandleLike,
  initialSize: number,
  prefixBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(prefixBytes) || prefixBytes < 0) {
    throw new RangeError('readPrefixBytes must be a non-negative safe integer')
  }
  const capacity = Math.min(initialSize, prefixBytes)
  const buffer = Buffer.allocUnsafe(capacity)
  let offset = 0
  while (offset < capacity) {
    const length = capacity - offset
    const result = await handle.read(buffer, offset, length, null)
    if (!Number.isInteger(result.bytesRead) || result.bytesRead < 0 || result.bytesRead > length) {
      return changed()
    }
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  if (offset !== capacity) changed()
  return buffer
}

export async function readVerifiedFile(rawPath: string, options: ReadVerifiedFileOptions): Promise<VerifiedFile> {
  const errors = options.errors ?? {}
  let canonical: string
  try {
    canonical = await realpath(path.resolve(rawPath))
  } catch {
    throw nativeError(errors.notFound ?? 'FILE_NOT_FOUND', 'File was not found')
  }
  await assertAllowed(canonical, options.allowedRoots, errors.outsideRoots ?? 'FILE_PATH_NOT_ALLOWED')

  let handle
  try {
    handle = await (options.openFile ?? open)(canonical, constants.O_RDONLY | noFollowFlag)
  } catch {
    throw nativeError(errors.notFound ?? 'FILE_NOT_FOUND', 'File could not be opened securely')
  }
  try {
    await options.hooks?.afterOpen?.({ purpose: options.purpose, path: canonical })
    const descriptorMetadata = await handle.stat()
    if (!descriptorMetadata.isFile()) {
      throw nativeError(errors.notFile ?? 'FILE_PATH_INVALID', 'Path is not a regular file')
    }
    if (descriptorMetadata.size > options.maxBytes) {
      throw nativeError(errors.tooLarge ?? 'FILE_TOO_LARGE', 'File exceeds the maximum allowed size')
    }
    const extension = path.extname(canonical).toLowerCase()
    if (options.allowedExtensions && !options.allowedExtensions.has(extension)) {
      throw nativeError(errors.typeNotAllowed ?? 'FILE_TYPE_NOT_ALLOWED', 'File type is not allowed')
    }
    const descriptorIdentity = identityOf(descriptorMetadata)
    if (options.expectedIdentity && !sameFileIdentity(descriptorIdentity, options.expectedIdentity)) changed()

    const rebound = await currentPathIdentity(canonical)
    if (!sameFileIdentity(descriptorIdentity, rebound.identity)) changed()
    if (descriptorMetadata.size !== rebound.size) changed()
    await assertAllowed(rebound.canonical, options.allowedRoots, errors.outsideRoots ?? 'FILE_PATH_NOT_ALLOWED')

    const shouldRead = options.readBytes !== false
    const bytes = shouldRead
      ? options.readPrefixBytes === undefined
        ? await readBounded(handle, options.maxBytes, descriptorMetadata.size)
        : await readPrefix(handle, descriptorMetadata.size, options.readPrefixBytes)
      : Buffer.alloc(0)
    const finalDescriptorMetadata = await handle.stat()
    if (!finalDescriptorMetadata.isFile()) changed()
    if (!sameFileIdentity(descriptorIdentity, identityOf(finalDescriptorMetadata))) changed()
    if (finalDescriptorMetadata.size > options.maxBytes || bytes.byteLength > options.maxBytes) {
      throw nativeError(errors.tooLarge ?? 'FILE_TOO_LARGE', 'File exceeds the maximum allowed size')
    }
    if (finalDescriptorMetadata.size !== descriptorMetadata.size) changed()
    const expectedBytes = options.readPrefixBytes === undefined
      ? finalDescriptorMetadata.size
      : Math.min(finalDescriptorMetadata.size, options.readPrefixBytes)
    if (shouldRead && bytes.byteLength !== expectedBytes) changed()

    const finalRebound = await currentPathIdentity(canonical)
    if (!sameFileIdentity(descriptorIdentity, finalRebound.identity)) changed()
    if (finalDescriptorMetadata.size !== finalRebound.size) changed()
    await assertAllowed(finalRebound.canonical, options.allowedRoots, errors.outsideRoots ?? 'FILE_PATH_NOT_ALLOWED')
    return { path: canonical, bytes, size: finalDescriptorMetadata.size, identity: descriptorIdentity, extension }
  } finally {
    await handle.close()
  }
}

export function verifyFile(rawPath: string, options: ReadVerifiedFileOptions): Promise<VerifiedFile> {
  return readVerifiedFile(rawPath, { ...options, readBytes: false })
}

export async function captureStableDirectory(directory: string, allowedRoot: string): Promise<FileIdentity> {
  const canonicalRoot = await realpath(path.resolve(allowedRoot))
  const canonicalDirectory = await realpath(directory)
  if (canonicalDirectory !== directory || !isPathInside(canonicalRoot, canonicalDirectory)) changed()
  const metadata = await stat(canonicalDirectory)
  if (!metadata.isDirectory()) changed()
  return identityOf(metadata)
}

export async function assertStableDirectory(directory: string, allowedRoot: string, expected: FileIdentity): Promise<void> {
  let canonicalRoot: string
  let canonicalDirectory: string
  try {
    canonicalRoot = await realpath(path.resolve(allowedRoot))
    canonicalDirectory = await realpath(directory)
  } catch {
    return changed()
  }
  if (canonicalDirectory !== directory || !isPathInside(canonicalRoot, canonicalDirectory)) changed()
  const metadata = await stat(canonicalDirectory).catch(() => undefined)
  if (!metadata?.isDirectory() || !sameFileIdentity(identityOf(metadata), expected)) changed()
}

/**
 * Creates a new managed file using an exclusive descriptor, then verifies that
 * both the descriptor and its parent path still name the same filesystem objects.
 */
export async function writeVerifiedExclusiveFile(
  destination: string,
  bytes: Buffer,
  options: WriteVerifiedFileOptions,
): Promise<string> {
  if (bytes.byteLength > options.maxBytes) {
    throw nativeError('ASSET_TOO_LARGE', 'File exceeds the maximum allowed size')
  }
  const directory = path.dirname(destination)
  const canonicalRoot = await realpath(path.resolve(options.allowedRoot))
  const canonicalDirectory = await realpath(directory)
  if (canonicalDirectory !== directory || !isPathInside(canonicalRoot, canonicalDirectory)) changed()
  const directoryIdentity = await captureStableDirectory(canonicalDirectory, canonicalRoot)

  await options.hooks?.beforeWriteRevalidation?.({ purpose: options.purpose, path: destination })
  await assertStableDirectory(canonicalDirectory, canonicalRoot, directoryIdentity)

  let handle
  try {
    handle = await open(
      destination,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag,
      options.mode ?? 0o600,
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw nativeError('FILE_ALREADY_EXISTS', 'Managed file destination already exists')
    }
    throw error
  }
  let keep = false
  try {
    await handle.writeFile(bytes)
    const descriptorMetadata = await handle.stat()
    if (!descriptorMetadata.isFile() || descriptorMetadata.size !== bytes.byteLength) changed()
    const descriptorIdentity = identityOf(descriptorMetadata)

    await options.hooks?.afterWriteOpen?.({ purpose: options.purpose, path: destination })
    await assertStableDirectory(canonicalDirectory, canonicalRoot, directoryIdentity)
    const rebound = await currentPathIdentity(destination)
    if (!sameFileIdentity(descriptorIdentity, rebound.identity)) changed()
    keep = true
    return destination
  } finally {
    await handle.close()
    if (!keep) {
      try {
        await assertStableDirectory(canonicalDirectory, canonicalRoot, directoryIdentity)
        await unlink(destination)
      } catch {
        // The parent changed or the entry disappeared. Never follow the changed path.
      }
    }
  }
}

export async function canonicalizeExistingSelection(rawPath: unknown, kind: 'file' | 'folder'): Promise<string> {
  if (typeof rawPath !== 'string' || rawPath.length < 1 || rawPath.length > 8_192 || rawPath.includes('\0')) {
    throw nativeError('INVALID_ATTACHMENT_SELECTION', 'Selected path is invalid')
  }
  let canonical: string
  let metadata: Stats
  try {
    canonical = await realpath(path.resolve(rawPath))
    metadata = await stat(canonical)
  } catch {
    throw nativeError('INVALID_ATTACHMENT_SELECTION', 'Selected path does not exist')
  }
  if (kind === 'file' ? !metadata.isFile() : !metadata.isDirectory()) {
    throw nativeError('INVALID_ATTACHMENT_SELECTION', `Selected path is not a ${kind}`)
  }
  return canonical
}
