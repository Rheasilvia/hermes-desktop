// @vitest-environment node
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createEnsuredPtySpawner,
  ensureSpawnHelperExecutable,
  writableNodePtyRoot,
  type SpawnHelperFs,
} from './spawn-helper-perms.js'

function fakeFs(files: Record<string, number>, directories: Record<string, string[]> = {}): SpawnHelperFs {
  return {
    existsSync: (candidate) => candidate in files || candidate in directories,
    readdirSync: (candidate) => directories[candidate] ?? [],
    statSync: (candidate) => ({ mode: files[candidate] ?? 0 }),
    chmodSync: (candidate, mode) => { files[candidate] = mode },
  }
}

describe('node-pty spawn-helper repair', () => {
  it('rewrites app.asar to the unpacked tree and best-effort adds execute bits', () => {
    const archived = '/App/Resources/app.asar/node_modules/node-pty'
    const unpacked = writableNodePtyRoot(archived)
    const prebuilds = path.join(unpacked, 'prebuilds')
    const helper = path.join(prebuilds, 'darwin-arm64', 'spawn-helper')
    const files = { [helper]: 0o644 }
    const result = ensureSpawnHelperExecutable(archived, fakeFs(files, { [prebuilds]: ['darwin-arm64'] }))
    expect(unpacked).toContain('app.asar.unpacked')
    expect(result.fixed).toEqual([helper])
    expect(files[helper]).toBe(0o755)
  })

  it('repairs once before pty.spawn on POSIX and is a no-op on Windows', () => {
    const order: string[] = []
    const spawn = vi.fn(() => { order.push('spawn'); return {} as never })
    const ensure = vi.fn(() => { order.push('ensure') })
    const wrapped = createEnsuredPtySpawner(spawn, { platform: 'linux', nodePtyRoot: '/pkg/node-pty', ensure })
    wrapped('/bin/zsh', [], {} as never)
    wrapped('/bin/zsh', [], {} as never)
    expect(order).toEqual(['ensure', 'spawn', 'spawn'])

    const windowsEnsure = vi.fn()
    createEnsuredPtySpawner(spawn, { platform: 'win32', nodePtyRoot: '/pkg/node-pty', ensure: windowsEnsure })('/bin/zsh', [], {} as never)
    expect(windowsEnsure).not.toHaveBeenCalled()
  })
})
