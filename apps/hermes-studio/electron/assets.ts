import { randomBytes as nodeRandomBytes } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { AssetReference } from '../src/shared/native-bridge.js'
import { nativeError } from './native-errors.js'
import {
  readVerifiedFile,
  type FileIdentity,
  type SafeFileHooks,
  verifyFile,
  writeVerifiedExclusiveFile,
} from './safe-file-access.js'
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
  identity: FileIdentity
}

export interface AssetRegistryOptions {
  allowedRoots: () => readonly string[]
  now?: () => number
  ttlMs?: number
  randomBytes?: (size: number) => Buffer
  maxHandles?: number
  hooks?: SafeFileHooks
}

export class AssetRegistry {
  readonly #allowedRoots: () => readonly string[]
  readonly #now: () => number
  readonly #ttlMs: number
  readonly #randomBytes: (size: number) => Buffer
  readonly #maxHandles: number
  readonly #hooks: SafeFileHooks | undefined
  readonly #handles = new Map<string, AssetHandle>()

  constructor(options: AssetRegistryOptions) {
    this.#allowedRoots = options.allowedRoots
    this.#now = options.now ?? Date.now
    this.#ttlMs = options.ttlMs ?? 10 * 60_000
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes
    this.#maxHandles = Math.max(1, options.maxHandles ?? 2_048)
    this.#hooks = options.hooks
  }

  get size(): number {
    return this.#handles.size
  }

  async issue(rawPath: string): Promise<string> {
    this.#sweepExpired()
    const verified = await this.#validateAllowedImage(rawPath)
    while (this.#handles.size >= this.#maxHandles) {
      const oldest = this.#handles.keys().next().value as string | undefined
      if (!oldest) break
      this.#handles.delete(oldest)
    }
    let handle = ''
    for (let attempt = 0; attempt < 8; attempt += 1) {
      handle = this.#randomBytes(32).toString('base64url')
      if (!this.#handles.has(handle)) break
      handle = ''
    }
    if (!handle) throw nativeError('ASSET_HANDLE_GENERATION_FAILED', 'Could not create a unique asset handle')
    this.#handles.set(handle, {
      path: verified.path,
      identity: verified.identity,
      expiresAt: this.#now() + this.#ttlMs,
    })
    return `${ASSET_SCHEME}//asset/${handle}`
  }

  async resolve(rawUrl: string): Promise<string> {
    const { handle, entry } = this.#entry(rawUrl)
    this.#sweepExpired()
    try {
      return (await this.#validateAllowedImage(entry.path, entry.identity)).path
    } catch (error) {
      this.#handles.delete(handle)
      throw error
    }
  }

  async read(rawUrl: string): Promise<{ path: string; bytes: Buffer }> {
    const { handle, entry } = this.#entry(rawUrl)
    this.#sweepExpired()
    try {
      const verified = await readVerifiedFile(entry.path, {
        allowedRoots: this.#allowedRoots,
        maxBytes: MAX_ASSET_BYTES,
        allowedExtensions: new Set(Object.keys(IMAGE_CONTENT_TYPES)),
        expectedIdentity: entry.identity,
        purpose: 'asset-protocol-read',
        hooks: this.#hooks,
        errors: {
          notFound: 'ASSET_PATH_NOT_FOUND',
          outsideRoots: 'ASSET_PATH_NOT_ALLOWED',
          notFile: 'ASSET_PATH_INVALID',
          tooLarge: 'ASSET_TOO_LARGE',
          typeNotAllowed: 'ASSET_TYPE_NOT_ALLOWED',
        },
      })
      return { path: verified.path, bytes: verified.bytes }
    } catch (error) {
      this.#handles.delete(handle)
      throw error
    }
  }

  #entry(rawUrl: string): { handle: string; entry: AssetHandle } {
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
    if (entry.expiresAt <= this.#now()) {
      this.#handles.delete(handle)
      throw nativeError('ASSET_HANDLE_EXPIRED', 'Asset handle has expired')
    }
    return { handle, entry }
  }

  clear(): void {
    this.#handles.clear()
  }

  #sweepExpired(): void {
    const now = this.#now()
    for (const [handle, entry] of this.#handles) {
      if (entry.expiresAt <= now) this.#handles.delete(handle)
    }
  }

  async #validateAllowedImage(rawPath: string, expectedIdentity?: FileIdentity) {
    if (typeof rawPath !== 'string' || rawPath.length < 1 || rawPath.length > 8_192 || rawPath.includes('\0')) {
      throw nativeError('ASSET_PATH_INVALID', 'Asset path is invalid')
    }
    return verifyFile(rawPath, {
      allowedRoots: this.#allowedRoots,
      maxBytes: MAX_ASSET_BYTES,
      allowedExtensions: new Set(Object.keys(IMAGE_CONTENT_TYPES)),
      expectedIdentity,
      purpose: expectedIdentity ? 'asset-handle-resolve' : 'asset-handle-issue',
      hooks: this.#hooks,
      errors: {
        notFound: 'ASSET_PATH_NOT_FOUND',
        outsideRoots: 'ASSET_PATH_NOT_ALLOWED',
        notFile: 'ASSET_PATH_INVALID',
        tooLarge: 'ASSET_TOO_LARGE',
        typeNotAllowed: 'ASSET_TYPE_NOT_ALLOWED',
      },
    })
  }
}

export interface SessionAssetStoreOptions {
  hermesHome: string
  registry: AssetRegistry
  managedSourceRoots: () => readonly string[]
  sessionSourceRoots: (sessionId: string) => readonly string[]
  validateImage: (bytes: Buffer, canonicalPath: string) => Promise<boolean> | boolean
  randomBytes?: (size: number) => Buffer
  hooks?: SafeFileHooks
}

export class SessionAssetStore {
  readonly #hermesHome: string
  readonly #registry: AssetRegistry
  readonly #managedSourceRoots: () => readonly string[]
  readonly #sessionSourceRoots: (sessionId: string) => readonly string[]
  readonly #validateImage: (bytes: Buffer, canonicalPath: string) => Promise<boolean> | boolean
  readonly #randomBytes: (size: number) => Buffer
  readonly #hooks: SafeFileHooks | undefined

  constructor(options: SessionAssetStoreOptions) {
    this.#hermesHome = path.resolve(options.hermesHome)
    this.#registry = options.registry
    this.#managedSourceRoots = options.managedSourceRoots
    this.#sessionSourceRoots = options.sessionSourceRoots
    this.#validateImage = options.validateImage
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes
    this.#hooks = options.hooks
  }

  async persist(sessionId: unknown, rawSource: unknown): Promise<AssetReference> {
    if (typeof sessionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(sessionId)) {
      throw nativeError('INVALID_SESSION_ID', 'sessionId contains unsupported characters')
    }
    if (typeof rawSource !== 'string' || rawSource.length < 1 || rawSource.length > 8_192 || rawSource.includes('\0')) {
      throw nativeError('ASSET_PATH_INVALID', 'Source image path is invalid')
    }
    const sourceRoots = [
      ...this.#managedSourceRoots(),
      ...this.#sessionSourceRoots(sessionId),
    ]
    const verified = await readVerifiedFile(rawSource, {
      allowedRoots: () => sourceRoots,
      maxBytes: MAX_ASSET_BYTES,
      allowedExtensions: new Set(Object.keys(IMAGE_CONTENT_TYPES)),
      purpose: 'session-asset-source',
      hooks: this.#hooks,
      errors: {
        notFound: 'ASSET_PATH_NOT_FOUND',
        outsideRoots: 'ASSET_SOURCE_NOT_ALLOWED',
        notFile: 'ASSET_PATH_INVALID',
        tooLarge: 'ASSET_TOO_LARGE',
        typeNotAllowed: 'ASSET_TYPE_NOT_ALLOWED',
      },
    })
    if (!await this.#validateImage(verified.bytes, verified.path)) {
      throw nativeError('ASSET_IMAGE_INVALID', 'Source image could not be decoded')
    }

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
    const destination = path.join(destinationDirectory, `${Date.now()}-${this.#randomBytes(16).toString('hex')}${verified.extension}`)
    await writeVerifiedExclusiveFile(destination, verified.bytes, {
      allowedRoot: canonicalHome,
      maxBytes: MAX_ASSET_BYTES,
      purpose: 'session-asset-destination',
      hooks: this.#hooks,
    })
    return { path: destination, url: await this.#registry.issue(destination) }
  }
}

export async function createAssetProtocolResponse(rawUrl: string, registry: AssetRegistry): Promise<Response> {
  const { path: assetPath, bytes: body } = await registry.read(rawUrl)
  const contentType = IMAGE_CONTENT_TYPES[path.extname(assetPath).toLowerCase()] ?? 'application/octet-stream'
  return new Response(Uint8Array.from(body), {
    status: 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  })
}
