export interface ImageFormat {
  readonly id: string
  readonly extensions: readonly string[]
  readonly mimeType: string
  readonly matches: (bytes: Buffer) => boolean
}

function startsWith(bytes: Buffer, signature: readonly number[]): boolean {
  return bytes.length >= signature.length
    && signature.every((value, index) => bytes[index] === value)
}

function asciiEquals(bytes: Buffer, offset: number, expected: string): boolean {
  return bytes.length >= offset + expected.length
    && bytes.subarray(offset, offset + expected.length).toString('ascii') === expected
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'])
const HEIF_BRANDS = new Set(['mif1', 'msf1'])
export const MAX_IMAGE_SIGNATURE_BYTES = 4 * 1024

function hasIsoBmffBrand(bytes: Buffer, accepted: ReadonlySet<string>): boolean {
  if (bytes.length < 16 || !asciiEquals(bytes, 4, 'ftyp')) return false
  const boxSize = bytes.readUInt32BE(0)
  if (boxSize < 16 || boxSize > bytes.length || boxSize > MAX_IMAGE_SIGNATURE_BYTES) return false
  if (accepted.has(bytes.subarray(8, 12).toString('ascii'))) return true
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    if (accepted.has(bytes.subarray(offset, offset + 4).toString('ascii'))) return true
  }
  return false
}

function defineFormat(format: ImageFormat): ImageFormat {
  return Object.freeze({
    ...format,
    extensions: Object.freeze([...format.extensions]),
  })
}

export const IMAGE_FORMATS: readonly ImageFormat[] = Object.freeze([
  defineFormat({
    id: 'png',
    extensions: ['png'],
    mimeType: 'image/png',
    matches: (bytes) => startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  }),
  defineFormat({
    id: 'jpeg',
    extensions: ['jpg', 'jpeg'],
    mimeType: 'image/jpeg',
    matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  }),
  defineFormat({
    id: 'gif',
    extensions: ['gif'],
    mimeType: 'image/gif',
    matches: (bytes) => asciiEquals(bytes, 0, 'GIF87a') || asciiEquals(bytes, 0, 'GIF89a'),
  }),
  defineFormat({
    id: 'webp',
    extensions: ['webp'],
    mimeType: 'image/webp',
    matches: (bytes) => asciiEquals(bytes, 0, 'RIFF') && asciiEquals(bytes, 8, 'WEBP'),
  }),
  defineFormat({
    id: 'bmp',
    extensions: ['bmp'],
    mimeType: 'image/bmp',
    matches: (bytes) => asciiEquals(bytes, 0, 'BM'),
  }),
  defineFormat({
    id: 'tiff',
    extensions: ['tiff', 'tif'],
    mimeType: 'image/tiff',
    matches: (bytes) => startsWith(bytes, [0x49, 0x49, 0x2a, 0x00])
      || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a]),
  }),
  defineFormat({
    id: 'heic',
    extensions: ['heic'],
    mimeType: 'image/heic',
    matches: (bytes) => hasIsoBmffBrand(bytes, HEIC_BRANDS),
  }),
  defineFormat({
    id: 'heif',
    extensions: ['heif'],
    mimeType: 'image/heif',
    matches: (bytes) => hasIsoBmffBrand(bytes, HEIF_BRANDS),
  }),
  defineFormat({
    id: 'ico',
    extensions: ['ico'],
    mimeType: 'image/x-icon',
    matches: (bytes) => startsWith(bytes, [0x00, 0x00, 0x01, 0x00]),
  }),
])

export const IMAGE_FILE_EXTENSIONS: readonly string[] = Object.freeze(
  IMAGE_FORMATS.flatMap((format) => format.extensions),
)

export const IMAGE_PICKER_FILTERS = Object.freeze([
  Object.freeze({ name: 'Images', extensions: IMAGE_FILE_EXTENSIONS }),
])

function normalizedExtension(extension: string): string {
  const normalized = extension.toLowerCase()
  return normalized.startsWith('.') ? normalized.slice(1) : normalized
}

export function imageFormatForExtension(extension: string): ImageFormat | undefined {
  const normalized = normalizedExtension(extension)
  return IMAGE_FORMATS.find((format) => format.extensions.includes(normalized))
}

export function isSupportedImageExtension(extension: string): boolean {
  return imageFormatForExtension(extension) !== undefined
}

export function sniffImageFormat(bytes: Buffer, extension?: string): ImageFormat | undefined {
  if (extension !== undefined) {
    const expected = imageFormatForExtension(extension)
    return expected?.matches(bytes) ? expected : undefined
  }
  return IMAGE_FORMATS.find((format) => format.matches(bytes))
}

export function imageMimeType(bytes: Buffer, extension: string): string | undefined {
  return sniffImageFormat(bytes, extension)?.mimeType
}
