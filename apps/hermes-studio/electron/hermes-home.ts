import { mkdir, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { nativeError } from './native-errors.js'
import {
  assertStableDirectory,
  captureStableDirectory,
  readVerifiedFile,
  type SafeFileHooks,
  writeVerifiedExclusiveFile,
} from './safe-file-access.js'
import { assertRelativePath, isPathInside } from './validation.js'

export interface HermesHomeFilesOptions {
  maxTextBytes?: number
  maxEntries?: number
  hooks?: SafeFileHooks
}

export class HermesHomeFiles {
  readonly #root: string
  readonly #maxTextBytes: number
  readonly #maxEntries: number
  readonly #hooks: SafeFileHooks | undefined

  constructor(root: string, options: HermesHomeFilesOptions = {}) {
    this.#root = path.resolve(root)
    this.#maxTextBytes = options.maxTextBytes ?? 1024 * 1024
    this.#maxEntries = options.maxEntries ?? 1_000
    this.#hooks = options.hooks
  }

  async getPath(): Promise<string> {
    return this.#canonicalRoot()
  }

  async readText(relativePath: unknown): Promise<string> {
    const target = await this.#resolveExisting(relativePath)
    const root = await this.#canonicalRoot()
    const { bytes } = await readVerifiedFile(target, {
      allowedRoots: () => [root],
      maxBytes: this.#maxTextBytes,
      purpose: 'hermes-home-read',
      hooks: this.#hooks,
      errors: {
        notFound: 'HERMES_HOME_PATH_NOT_FOUND',
        outsideRoots: 'PATH_OUTSIDE_HERMES_HOME',
        notFile: 'HERMES_HOME_NOT_FILE',
        tooLarge: 'TEXT_TOO_LARGE',
      },
    })
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch {
      throw nativeError('INVALID_TEXT_ENCODING', 'Text file is not valid UTF-8')
    }
  }

  async writeText(relativePath: unknown, content: unknown): Promise<void> {
    if (typeof content !== 'string') throw nativeError('INVALID_ARGUMENT', 'content must be a string')
    if (Buffer.byteLength(content, 'utf8') > this.#maxTextBytes) {
      throw nativeError('TEXT_TOO_LARGE', 'Text content exceeds the maximum allowed size')
    }
    const relative = assertRelativePath(relativePath)
    const root = await this.#canonicalRoot()
    const canonicalParent = await this.#ensureDirectory(root, path.dirname(relative))
    const parentIdentity = await captureStableDirectory(canonicalParent, root)
    const target = path.join(canonicalParent, path.basename(relative))
    try {
      const existing = await realpath(target)
      if (!isPathInside(root, existing)) throw nativeError('PATH_OUTSIDE_HERMES_HOME', 'path escapes HERMES_HOME')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const temporary = path.join(canonicalParent, `.studio-${randomBytes(12).toString('hex')}.tmp`)
    const bytes = Buffer.from(content, 'utf8')
    let renamed = false
    try {
      await writeVerifiedExclusiveFile(temporary, bytes, {
        allowedRoot: root,
        maxBytes: this.#maxTextBytes,
        purpose: 'hermes-home-write',
        hooks: this.#hooks,
      })
      const temporaryMetadata = await stat(temporary)
      const temporaryIdentity = { dev: temporaryMetadata.dev, ino: temporaryMetadata.ino }
      await this.#hooks?.beforeWriteCommit?.({ purpose: 'hermes-home-write', path: target })
      await assertStableDirectory(canonicalParent, root, parentIdentity)
      await rename(temporary, target)
      renamed = true
      await this.#hooks?.afterWriteCommit?.({ purpose: 'hermes-home-write', path: target })
      await assertStableDirectory(canonicalParent, root, parentIdentity)
      const written = await readVerifiedFile(target, {
        allowedRoots: () => [root],
        maxBytes: this.#maxTextBytes,
        expectedIdentity: temporaryIdentity,
        purpose: 'hermes-home-write-verify',
        hooks: this.#hooks,
        errors: {
          outsideRoots: 'PATH_OUTSIDE_HERMES_HOME',
          notFile: 'HERMES_HOME_NOT_FILE',
          tooLarge: 'TEXT_TOO_LARGE',
        },
      })
      if (!written.bytes.equals(bytes)) {
        throw nativeError('FILE_CHANGED_DURING_ACCESS', 'File changed during secure access')
      }
    } catch (error) {
      if (!renamed) {
        try {
          await assertStableDirectory(canonicalParent, root, parentIdentity)
          await unlink(temporary)
        } catch {
          // The directory changed; do not follow a now-untrusted cleanup path.
        }
      }
      throw error
    }
  }

  async list(relativePath: unknown): Promise<string[]> {
    const target = await this.#resolveExisting(relativePath)
    const metadata = await stat(target)
    if (!metadata.isDirectory()) throw nativeError('HERMES_HOME_NOT_DIRECTORY', 'Requested path is not a directory')
    const root = await this.#canonicalRoot()
    const directoryIdentity = await captureStableDirectory(target, root)
    await this.#hooks?.afterOpen?.({ purpose: 'hermes-home-list', path: target })
    await assertStableDirectory(target, root, directoryIdentity)
    const entries = await readdir(target)
    await this.#hooks?.afterDirectoryRead?.({ purpose: 'hermes-home-list', path: target })
    await assertStableDirectory(target, root, directoryIdentity)
    if (entries.length > this.#maxEntries) throw nativeError('DIRECTORY_TOO_LARGE', 'Directory contains too many entries')
    return entries.sort((a, b) => a.localeCompare(b))
  }

  async #canonicalRoot(): Promise<string> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 })
    return realpath(this.#root)
  }

  async #resolveExisting(relativePath: unknown): Promise<string> {
    const relative = assertRelativePath(relativePath)
    const root = await this.#canonicalRoot()
    let target: string
    try {
      target = await realpath(path.join(this.#root, relative))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw nativeError('HERMES_HOME_PATH_NOT_FOUND', 'Requested HERMES_HOME path was not found')
      }
      throw error
    }
    if (!isPathInside(root, target)) throw nativeError('PATH_OUTSIDE_HERMES_HOME', 'path escapes HERMES_HOME')
    return target
  }

  async #ensureDirectory(root: string, relativeDirectory: string): Promise<string> {
    let current = root
    const segments = relativeDirectory === '.' ? [] : relativeDirectory.split(path.sep)
    for (const segment of segments) {
      const candidate = path.join(current, segment)
      let canonical: string
      try {
        canonical = await realpath(candidate)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await mkdir(candidate, { mode: 0o700 })
        canonical = await realpath(candidate)
      }
      if (!isPathInside(root, canonical)) {
        throw nativeError('PATH_OUTSIDE_HERMES_HOME', 'path escapes HERMES_HOME')
      }
      if (!(await stat(canonical)).isDirectory()) {
        throw nativeError('HERMES_HOME_NOT_DIRECTORY', 'Requested parent path is not a directory')
      }
      current = canonical
    }
    return current
  }
}
