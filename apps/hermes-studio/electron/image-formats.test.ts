// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  IMAGE_FILE_EXTENSIONS,
  IMAGE_FORMATS,
  IMAGE_PICKER_FILTERS,
  imageMimeType,
  sniffImageFormat,
} from './image-formats.js'

function isoBmff(...brands: string[]): Buffer {
  const bytes = Buffer.alloc(16 + Math.max(0, brands.length - 1) * 4)
  bytes.writeUInt32BE(bytes.length, 0)
  bytes.write('ftyp', 4, 'ascii')
  bytes.write(brands[0] ?? 'mif1', 8, 'ascii')
  for (let index = 1; index < brands.length; index += 1) {
    bytes.write(brands[index]!, 12 + index * 4, 'ascii')
  }
  return bytes
}

describe('canonical image formats', () => {
  it('advertises every supported extension from the canonical table', () => {
    expect(IMAGE_FILE_EXTENSIONS).toEqual([
      'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic', 'heif', 'ico',
    ])
    expect(IMAGE_PICKER_FILTERS).toEqual([
      { name: 'Images', extensions: IMAGE_FILE_EXTENSIONS },
    ])
    expect(new Set(IMAGE_FORMATS.flatMap((format) => format.extensions))).toEqual(new Set(IMAGE_FILE_EXTENSIONS))
  })

  it.each([
    ['png', '.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['jpeg', '.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xdb])],
    ['gif', '.gif', Buffer.from('GIF89a', 'ascii')],
    ['webp', '.webp', Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary')],
    ['bmp', '.bmp', Buffer.from('BM', 'ascii')],
    ['ico', '.ico', Buffer.from([0x00, 0x00, 0x01, 0x00])],
    ['tiff', '.tif', Buffer.from([0x49, 0x49, 0x2a, 0x00])],
    ['tiff', '.tiff', Buffer.from([0x4d, 0x4d, 0x00, 0x2a])],
    ['heic', '.heic', isoBmff('heic', 'mif1')],
    ['heif', '.heif', isoBmff('mif1', 'heix')],
  ])('sniffs %s signatures for %s', (formatId, extension, bytes) => {
    expect(sniffImageFormat(bytes, extension)?.id).toBe(formatId)
  })

  it('accepts compatible HEIC and HEIF brands inside a bounded ftyp box', () => {
    expect(sniffImageFormat(isoBmff('mif1', 'hevc'), '.heic')?.id).toBe('heic')
    expect(sniffImageFormat(isoBmff('heix', 'msf1'), '.heif')?.id).toBe('heif')
    expect(sniffImageFormat(Buffer.from('not-an-ftyp-box'), '.heic')).toBeUndefined()
  })

  it('rejects an ftyp box whose accepted brand appears only beyond the fixed inspection budget', () => {
    const bytes = Buffer.alloc(4_100)
    bytes.writeUInt32BE(bytes.length, 0)
    bytes.write('ftyp', 4, 'ascii')
    bytes.write('xxxx', 8, 'ascii')
    bytes.write('heic', bytes.length - 4, 'ascii')

    expect(sniffImageFormat(bytes, '.heic')).toBeUndefined()
  })

  it('requires the signature to agree with the advertised extension and derives MIME from that match', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(sniffImageFormat(png, '.jpg')).toBeUndefined()
    expect(imageMimeType(png, '.png')).toBe('image/png')
    expect(imageMimeType(Buffer.from([0x49, 0x49, 0x2a, 0x00]), '.tiff')).toBe('image/tiff')
  })
})
