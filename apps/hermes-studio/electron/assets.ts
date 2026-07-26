import { randomBytes as nodeRandomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AssetReference } from '../src/shared/native-bridge.js'
import { nativeError } from './native-errors.js'
import { isPathInside } from './validation.js'

const MAX_ASSET_BYTES = 32 * 1024 * 1024
const ASSET_SCHEME = 'hermes-studio-asset:'
const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
}

interface AssetHandle {
  path: string
  expiresAt: number
}

export interface AssetRegistryOptions {
  allowedRoots: () => readonly string[]
  now?: () => number
  ttlMs?: number
  randomBytes?: (size: number) => Buffer
}

export class AssetRegistry {
  readonly #allowedRoots: () => readonly string[]
  readonly #now: () => number
  readonly #ttlMs: number
  readonly #randomBytes: (size: number) => Buffer
  readonly #handles = new Map<string, AssetHandle>()

  constructor(options: AssetRegistryOptions) {
    this.#allowedRoots = options.allowedRoots
    this.#now = options.now ?? Date.now
    this.#ttlMs = options.ttlMs ?? 10 * 60_000
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes
  }

  async issue(rawPath: string): Promise<string> {
    const canonical = await this.#validateAllowedImage(rawPath)
    const handle = this.#randomBytes(32).toString('base64url')
    this.#handles.set(handle, { path: canonical, expiresAt: this.#now() + this.#ttlMs })
    return `${ASSET_SCHEME}//asset/${handle}`
  }

  async resolve(rawUrl: string): Promise<string> {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      throw nativeError('ASSET_HANDLE_INVALID', 'Asset handle is invalid')
    }
    const handle = url.pathname.replace(/^\//, '')
    if (
      url.protocol !== ASSET_SCHEME
      || url.hostname !== 'asset'
      || !/^[A-Za-z0-9_-]{32,}$/.test(handle)
      || url.search
      || url.hash
    ) throw nativeError('ASSET_HANDLE_INVALID', 'Asset handle is invalid')
    const entry = this.#handles.get(handle)
    if (!entry) throw nativeError('ASSET_HANDLE_INVALID', 'Asset handle is invalid')
    if (entry.expiresAt < this.#now()) {
      this.#handles.delete(handle)
      throw nativeError('ASSET_HANDLE_EXPIRED', 'Asset handle has expired')
    }
    return this.#validateAllowedImage(entry.path)
  }

  clear(): void {
    this.#handles.clear()
  }

  async #validateAllowedImage(rawPath: string): Promise<string> {
    if (typeof rawPath !== 'string' || rawPath.length < 1 || rawPath.length > 8_192 || rawPath.includes('\0')) {
      throw nativeError('ASSET_PATH_INVALID', 'Asset path is invalid')
    }
    let canonical: string
    try {
      canonical = await realpath(path.resolve(rawPath))
    } catch {
      throw nativeError('ASSET_PATH_NOT_FOUND', 'Asset path was not found')
    }
    const roots = await Promise.all(this.#allowedRoots().map(async (root) => {
      try { return await realpath(path.resolve(root)) } catch { return undefined }
    }))
    if (!roots.some((root) => root && isPathInside(root, canonical))) {
      throw nativeError('ASSET_PATH_NOT_ALLOWED', 'Asset path is outside the allowed roots')
    }
    const metadata = await stat(canonical)
    if (!metadata.isFile()) throw nativeError('ASSET_PATH_INVALID', 'Asset path is not a file')
    if (metadata.size > MAX_ASSET_BYTES) throw nativeError('ASSET_TOO_LARGE', 'Asset exceeds the maximum allowed size')
    if (!IMAGE_CONTENT_TYPES[path.extname(canonical).toLowerCase()]) {
      throw nativeError('ASSET_TYPE_NOT_ALLOWED', 'Asset file type is not allowed')
    }
    return canonical
  }
}

export interface SessionAssetStoreOptions {
  hermesHome: string
  registry: AssetRegistry
  sourceRoots: () => readonly string[]
  validateImage: (path: string) => Promise<boolean> | boolean
  randomBytes?: (size: number) => Buffer
}

export class SessionAssetStore {
  readonly #hermesHome: string
  readonly #registry: AssetRegistry
  readonly #sourceRoots: () => readonly string[]
  readonly #validateImage: (path: string) => Promise<boolean> | boolean
  readonly #randomBytes: (size: number) => Buffer

  constructor(options: SessionAssetStoreOptions) {
    this.#hermesHome = path.resolve(options.hermesHome)
    this.#registry = options.registry
    this.#sourceRoots = options.sourceRoots
    this.#validateImage = options.validateImage
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes
  }

  async persist(sessionId: unknown, rawSource: unknown): Promise<AssetReference> {
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(sessionId)) {
      throw nativeError('INVALID_SESSION_ID', 'sessionId contains unsupported characters')
    }
    if (typeof rawSource !== 'string' || rawSource.length < 1 || rawSource.length > 8_192 || rawSource.includes('\0')) {
      throw nativeError('ASSET_PATH_INVALID', 'Source image path is invalid')
    }
    let source: string
    try {
      source = await realpath(path.resolve(rawSource))
    } catch {
      throw nativeError('ASSET_PATH_NOT_FOUND', 'Source image was not found')
    }
    const sourceRoots = await Promise.all(this.#sourceRoots().map(async (root) => {
      try { return await realpath(path.resolve(root)) } catch { return undefined }
    }))
    if (!sourceRoots.some((root) => root && isPathInside(root, source))) {
      throw nativeError('ASSET_SOURCE_NOT_ALLOWED', 'Source image is outside the allowed roots')
    }
    const metadata = await stat(source)
    if (!metadata.isFile()) throw nativeError('ASSET_PATH_INVALID', 'Source image is not a file')
    if (metadata.size > MAX_ASSET_BYTES) throw nativeError('ASSET_TOO_LARGE', 'Source image exceeds the maximum allowed size')
    const extension = path.extname(source).toLowerCase()
    if (!IMAGE_CONTENT_TYPES[extension]) throw nativeError('ASSET_TYPE_NOT_ALLOWED', 'Source image type is not allowed')
    if (!await this.#validateImage(source)) throw nativeError('ASSET_IMAGE_INVALID', 'Source image could not be decoded')

    await mkdir(this.#hermesHome, { recursive: true, mode: 0o700 })
    const canonicalHome = await realpath(this.#hermesHome)
    let destinationDirectory = canonicalHome
    for (const segment of ['sessions', sessionId, 'assets']) {
      const candidate = path.join(destinationDirectory, segment)
      let canonical: string
      try {
        canonical = await realpath(candidate)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        await mkdir(candidate, { mode: 0o700 })
        canonical = await realpath(candidate)
      }
      if (!isPathInside(canonicalHome, canonical) || !(await stat(canonical)).isDirectory()) {
        throw nativeError('ASSET_DESTINATION_NOT_ALLOWED', 'Session asset destination is outside Hermes Home')
      }
      destinationDirectory = canonical
    }
    const destination = path.join(destinationDirectory, `${Date.now()}-${this.#randomBytes(16).toString('hex')}${extension}`)
    await copyFile(source, destination, constants.COPYFILE_EXCL)
    return { path: destination, url: await this.#registry.issue(destination) }
  }
}

export async function createAssetProtocolResponse(rawUrl: string, registry: AssetRegistry): Promise<Response> {
  const assetPath = await registry.resolve(rawUrl)
  const body = await readFile(assetPath)
  const contentType = IMAGE_CONTENT_TYPES[path.extname(assetPath).toLowerCase()] ?? 'application/octet-stream'
  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
