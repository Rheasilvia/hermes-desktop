// @vitest-environment node
import { existsSync, mkdtempSync, mkdirSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it('fails closed when a text file is swapped after its descriptor is opened', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-read-race-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-home-read-race-outside-'))
    const target = path.join(root, 'note.txt')
    writeFileSync(target, 'safe')
    writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    const files = new HermesHomeFiles(root, {
      hooks: {
        afterOpen: ({ purpose }) => {
          if (purpose !== 'hermes-home-read') return
          renameSync(target, `${target}.original`)
          symlinkSync(path.join(outside, 'secret.txt'), target)
        },
      },
    })

    await expect(files.readText('note.txt')).rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
  })

  it('revalidates the destination directory immediately before writing', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-write-race-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-home-write-race-outside-'))
    const config = path.join(root, 'config')
    mkdirSync(config)
    const files = new HermesHomeFiles(root, {
      hooks: {
        beforeWriteRevalidation: () => {
          renameSync(config, `${config}.original`)
          symlinkSync(outside, config)
        },
      },
    })

    await expect(files.writeText('config/settings.json', '{}'))
      .rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
    expect(existsSync(path.join(outside, 'settings.json'))).toBe(false)
    expect(readdirSync(outside)).toEqual([])
  })

  it.each(['beforeWriteCommit', 'afterWriteCommit'] as const)(
    'revalidates the destination directory at %s',
    async (phase) => {
      const root = mkdtempSync(path.join(tmpdir(), `studio-home-${phase}-`))
      const outside = mkdtempSync(path.join(tmpdir(), `studio-home-${phase}-outside-`))
      const config = path.join(root, 'config')
      mkdirSync(config)
      const swap = () => {
        renameSync(config, `${config}.original`)
        symlinkSync(outside, config)
      }
      const files = new HermesHomeFiles(root, {
        hooks: phase === 'beforeWriteCommit'
          ? { beforeWriteCommit: swap }
          : { afterWriteCommit: swap },
      })

      await expect(files.writeText('config/settings.json', '{}'))
        .rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
      expect(readdirSync(outside)).toEqual([])
    },
  )

  it('allows exactly the configured list limit and rejects one entry more', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-list-limit-'))
    writeFileSync(path.join(root, 'a'), '')
    writeFileSync(path.join(root, 'b'), '')
    const files = new HermesHomeFiles(root, { maxEntries: 2 })

    expect(await files.list('.')).toEqual(['a', 'b'])
    writeFileSync(path.join(root, 'c'), '')
    await expect(files.list('.')).rejects.toMatchObject({ code: 'DIRECTORY_TOO_LARGE' })
  })

  it('stops directory iteration immediately after maxEntries + 1 during growth', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-list-growth-'))
    let pulls = 0
    let returned = false
    const names = ['a', 'b', 'grown', 'must-not-be-read']
    const files = new HermesHomeFiles(root, {
      maxEntries: 2,
      openDirectory: async () => ({
        [Symbol.asyncIterator]() {
          let index = 0
          return {
            async next() {
              pulls += 1
              if (index === 1) writeFileSync(path.join(root, 'concurrent-growth'), '')
              return { done: false as const, value: { name: names[index++] ?? 'unexpected' } }
            },
            async return() {
              returned = true
              return { done: true as const, value: undefined }
            },
          }
        },
      }),
    })

    await expect(files.list('.')).rejects.toMatchObject({ code: 'DIRECTORY_TOO_LARGE' })
    expect(pulls).toBe(3)
    expect(returned).toBe(true)
  })

  it('fails closed when a listed directory is swapped before readdir', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-list-race-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-home-list-race-outside-'))
    const listed = path.join(root, 'listed')
    mkdirSync(listed)
    writeFileSync(path.join(listed, 'safe'), '')
    writeFileSync(path.join(outside, 'secret'), '')
    const files = new HermesHomeFiles(root, {
      hooks: {
        afterOpen: ({ purpose }) => {
          if (purpose !== 'hermes-home-list') return
          renameSync(listed, `${listed}.original`)
          symlinkSync(outside, listed)
        },
      },
    })

    await expect(files.list('listed')).rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
  })

  it('fails closed when a listed directory is swapped immediately after readdir', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-home-list-post-race-'))
    const outside = mkdtempSync(path.join(tmpdir(), 'studio-home-list-post-race-outside-'))
    const listed = path.join(root, 'listed')
    mkdirSync(listed)
    writeFileSync(path.join(listed, 'safe'), '')
    writeFileSync(path.join(outside, 'secret'), '')
    const files = new HermesHomeFiles(root, {
      hooks: {
        afterDirectoryRead: ({ purpose }) => {
          if (purpose !== 'hermes-home-list') return
          renameSync(listed, `${listed}.original`)
          symlinkSync(outside, listed)
        },
      },
    })

    await expect(files.list('listed')).rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_ACCESS' })
  })
})
