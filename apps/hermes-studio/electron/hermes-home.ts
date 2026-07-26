import { constants } from 'node:fs'
import { mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { nativeError } from './native-errors.js'
import { assertRelativePath, isPathInside } from './validation.js'

export interface HermesHomeFilesOptions {
  maxTextBytes?: number
  maxEntries?: number
}

export class HermesHomeFiles {
  readonly #root: string
  readonly #maxTextBytes: number
  readonly #maxEntries: number

  constructor(root: string, options: HermesHomeFilesOptions = {}) {
    this.#root = path.resolve(root)
    this.#maxTextBytes = options.maxTextBytes ?? 1024 * 1024
    this.#maxEntries = options.maxEntries ?? 1_000
  }

  async getPath(): Promise<string> {
    return this.#canonicalRoot()
  }

  async readText(relativePath: unknown): Promise<string> {
    const target = await this.#resolveExisting(relativePath)
    const metadata = await stat(target)
    if (!metadata.isFile()) throw nativeError('HERMES_HOME_NOT_FILE', 'Requested path is not a file')
    if (metadata.size > this.#maxTextBytes) throw nativeError('TEXT_TOO_LARGE', 'Text file exceeds the maximum allowed size')
    const bytes = await readFile(target)
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
    const target = path.join(canonicalParent, path.basename(relative))
    try {
      const existing = await realpath(target)
      if (!isPathInside(root, existing)) throw nativeError('PATH_OUTSIDE_HERMES_HOME', 'path escapes HERMES_HOME')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const temporary = path.join(canonicalParent, `.studio-${randomBytes(12).toString('hex')}.tmp`)
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY })
    try {
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  async list(relativePath: unknown): Promise<string[]> {
    const target = await this.#resolveExisting(relativePath)
    const metadata = await stat(target)
    if (!metadata.isDirectory()) throw nativeError('HERMES_HOME_NOT_DIRECTORY', 'Requested path is not a directory')
    const entries = await readdir(target)
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
