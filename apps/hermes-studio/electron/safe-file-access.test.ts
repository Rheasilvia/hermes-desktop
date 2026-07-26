// @vitest-environment node
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { readVerifiedFile, type ReadFileHandleLike } from './safe-file-access.js'

describe('readVerifiedFile bounded descriptor reads', () => {
  it('requests and allocates at most maxBytes + 1 when the open file grows', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-bounded-read-'))
    const target = path.join(root, 'growing.txt')
    writeFileSync(target, '1234')
    const realHandle = await open(target, 'r')
    const requestedLengths: number[] = []
    const bufferLengths: number[] = []
    let grew = false
    const forbiddenReadFile = vi.fn(() => {
      throw new Error('readFile must never be used for a bounded read')
    })
    const handle = {
      stat: () => realHandle.stat(),
      read: async (buffer: Buffer, offset: number, length: number, position: number | null) => {
        requestedLengths.push(length)
        bufferLengths.push(buffer.byteLength)
        if (!grew) {
          grew = true
          appendFileSync(target, '56789')
        }
        return realHandle.read(buffer, offset, length, position)
      },
      readFile: forbiddenReadFile,
      close: () => realHandle.close(),
    } satisfies ReadFileHandleLike & { readFile: typeof forbiddenReadFile }

    await expect(readVerifiedFile(target, {
      allowedRoots: () => [root],
      maxBytes: 4,
      purpose: 'bounded-growth-test',
      openFile: async () => handle,
    })).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })

    expect(requestedLengths).toEqual([5])
    expect(bufferLengths).toEqual([5])
    expect(forbiddenReadFile).not.toHaveBeenCalled()
  })

  it('fails closed when descriptor size changes during an otherwise bounded read', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-bounded-read-size-'))
    const target = path.join(root, 'growing.txt')
    writeFileSync(target, 'ab')
    const realHandle = await open(target, 'r')
    let grew = false
    const handle: ReadFileHandleLike = {
      stat: () => realHandle.stat(),
      read: async (buffer, offset, length, position) => {
        if (!grew) {
          grew = true
          appendFileSync(target, 'c')
        }
        return realHandle.read(buffer, offset, length, position)
      },
      close: () => realHandle.close(),
    }

    await expect(readVerifiedFile(target, {
      allowedRoots: () => [root],
      maxBytes: 8,
      purpose: 'bounded-size-change-test',
      openFile: async () => handle,
    })).rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
  })

  it('allocates and requests only the verified tiny size plus one under a large limit', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-bounded-read-tiny-'))
    const target = path.join(root, 'tiny.txt')
    writeFileSync(target, 'tiny')
    const realHandle = await open(target, 'r')
    const requestedLengths: number[] = []
    const bufferLengths: number[] = []
    const handle: ReadFileHandleLike = {
      stat: () => realHandle.stat(),
      read: async (buffer, offset, length, position) => {
        requestedLengths.push(length)
        bufferLengths.push(buffer.byteLength)
        return realHandle.read(buffer, offset, length, position)
      },
      close: () => realHandle.close(),
    }

    await expect(readVerifiedFile(target, {
      allowedRoots: () => [root],
      maxBytes: 32 * 1024 * 1024,
      purpose: 'bounded-tiny-test',
      openFile: async () => handle,
    })).resolves.toMatchObject({ bytes: Buffer.from('tiny') })

    expect(Math.max(...requestedLengths)).toBeLessThanOrEqual(5)
    expect(new Set(bufferLengths)).toEqual(new Set([5]))
  })

  it('can verify a large stable file while reading only a bounded signature prefix', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-bounded-read-prefix-'))
    const target = path.join(root, 'large.bin')
    writeFileSync(target, Buffer.alloc(16 * 1024, 0x5a))
    const realHandle = await open(target, 'r')
    const requestedLengths: number[] = []
    const bufferLengths: number[] = []
    const handle: ReadFileHandleLike = {
      stat: () => realHandle.stat(),
      read: async (buffer, offset, length, position) => {
        requestedLengths.push(length)
        bufferLengths.push(buffer.byteLength)
        return realHandle.read(buffer, offset, length, position)
      },
      close: () => realHandle.close(),
    }

    await expect(readVerifiedFile(target, {
      allowedRoots: () => [root],
      maxBytes: 32 * 1024,
      readPrefixBytes: 64,
      purpose: 'bounded-prefix-test',
      openFile: async () => handle,
    })).resolves.toMatchObject({ bytes: Buffer.alloc(64, 0x5a), size: 16 * 1024 })

    expect(Math.max(...requestedLengths)).toBeLessThanOrEqual(64)
    expect(new Set(bufferLengths)).toEqual(new Set([64]))
  })
})
