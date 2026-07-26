import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AssetReference } from '../src/shared/native-bridge.js'
import type { AssetRegistry } from './assets.js'
import { nativeError } from './native-errors.js'
import { fetchRemoteImage } from './remote-image.js'

const MAX_IMAGE_BYTES = 32 * 1024 * 1024

export interface NativeImageLike {
  isEmpty(): boolean
  toPNG(): Buffer
}

export interface ClipboardImagesOptions {
  managedRoot: string
  registry: AssetRegistry
  readImage: () => NativeImageLike
  writeImage: (image: NativeImageLike) => void
  createImage: (bytes: Buffer) => NativeImageLike
  fetchImage?: typeof fetchRemoteImage
  randomBytes?: (size: number) => Buffer
}

export class ClipboardImages {
  readonly managedRoot: string
  readonly #registry: AssetRegistry
  readonly #readImage: () => NativeImageLike
  readonly #writeImage: (image: NativeImageLike) => void
  readonly #createImage: (bytes: Buffer) => NativeImageLike
  readonly #fetchImage: typeof fetchRemoteImage
  readonly #randomBytes: (size: number) => Buffer

  constructor(options: ClipboardImagesOptions) {
    this.managedRoot = path.resolve(options.managedRoot)
    this.#registry = options.registry
    this.#readImage = options.readImage
    this.#writeImage = options.writeImage
    this.#createImage = options.createImage
    this.#fetchImage = options.fetchImage ?? fetchRemoteImage
    this.#randomBytes = options.randomBytes ?? randomBytes
  }

  async read(): Promise<AssetReference | null> {
    const image = this.#readImage()
    if (image.isEmpty()) return null
    const bytes = image.toPNG()
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw nativeError('CLIPBOARD_IMAGE_TOO_LARGE', 'Clipboard image exceeds the maximum allowed size')
    await mkdir(this.managedRoot, { recursive: true, mode: 0o700 })
    const imagePath = path.join(this.managedRoot, `clipboard-${Date.now()}-${this.#randomBytes(16).toString('hex')}.png`)
    await writeFile(imagePath, bytes, { mode: 0o600, flag: 'wx' })
    return { path: imagePath, url: await this.#registry.issue(imagePath) }
  }

  async copyRemote(rawUrl: unknown): Promise<void> {
    if (typeof rawUrl !== 'string') throw nativeError('INVALID_ARGUMENT', 'url must be a string')
    const bytes = await this.#fetchImage(rawUrl)
    const image = this.#createImage(bytes)
    if (image.isEmpty()) throw nativeError('REMOTE_IMAGE_INVALID', 'Remote image could not be decoded')
    this.#writeImage(image)
  }
}
