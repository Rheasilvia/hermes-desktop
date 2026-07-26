// @vitest-environment node
import { existsSync, mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { HermesHomeFiles } from './hermes-home.js'

describe('HermesHomeFiles', () => {
  it('reads, writes, and lists bounded UTF-8 text beneath the canonical home', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-'))
    const files = new HermesHomeFiles(root)

    await files.writeText('config/studio.json', '{"theme":"dark"}')

    expect(await files.readText('config/studio.json')).toBe('{"theme":"dark"}')
    expect(await files.list('config')).toEqual(['studio.json'])
  })

  it('rejects absolute paths, traversal, NULs, oversized content, and invalid UTF-8', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-invalid-'))
    const files = new HermesHomeFiles(root, { maxTextBytes: 16 })
    writeFileSync(path.join(root, 'binary'), Buffer.from([0xff, 0xfe, 0xfd]))

    await expect(files.readText('../secret')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_HERMES_HOME' })
    await expect(files.readText('/tmp/secret')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(files.readText('bad\0name')).rejects.toMatchObject({ code: 'INVALID_PATH' })
    await expect(files.writeText('large', 'x'.repeat(17))).rejects.toMatchObject({ code: 'TEXT_TOO_LARGE' })
    await expect(files.readText('binary')).rejects.toMatchObject({ code: 'INVALID_TEXT_ENCODING' })
  })

  it('rejects symlink escapes for reads, writes, and lists', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-link-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-outside-'))
    writeFileSync(path.join(outside, 'secret'), 'nope')
    mkdirSync(path.join(root, 'safe'))
    symlinkSync(outside, path.join(root, 'safe', 'escape'))
    const files = new HermesHomeFiles(root)

    await expect(files.readText('safe/escape/secret')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_HERMES_HOME' })
    await expect(files.writeText('safe/escape/new', 'nope')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_HERMES_HOME' })
    await expect(files.list('safe/escape')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_HERMES_HOME' })
  })

  it('does not create directories through a symlink before rejecting an escaped write', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-write-link-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-home-write-outside-'))
    mkdirSync(path.join(root, 'safe'))
    symlinkSync(outside, path.join(root, 'safe', 'escape'))
    const files = new HermesHomeFiles(root)

    await expect(files.writeText('safe/escape/created/file', 'nope'))
      .rejects.toMatchObject({ code: 'PATH_OUTSIDE_HERMES_HOME' })
    expect(existsSync(path.join(outside, 'created'))).toBe(false)
  })
})
