// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TerminalManager, type PtyProcessLike, type PtySpawner } from './terminal-manager.js'

class FakePty extends EventEmitter implements PtyProcessLike {
  pid = 42
  writes: string[] = []
  resizes: Array<[number, number]> = []
  killed = false

  write(data: string): void { this.writes.push(data) }
  resize(cols: number, rows: number): void { this.resizes.push([cols, rows]) }
  kill(): void { this.killed = true }
  onData(listener: (data: string) => void): { dispose(): void } {
    this.on('data', listener)
    return { dispose: () => this.off('data', listener) }
  }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    this.on('exit', listener)
    return { dispose: () => this.off('exit', listener) }
  }
}

class ImmediateExitPty extends FakePty {
  disposed = 0

  override onData(listener: (data: string) => void): { dispose(): void } {
    this.on('data', listener)
    return { dispose: () => { this.disposed += 1; this.off('data', listener) } }
  }

  override onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void } {
    listener({ exitCode: 127 })
    return { dispose: () => { this.disposed += 1 } }
  }
}

describe('TerminalManager', () => {
  it('routes PTY data/write/resize/exit by opaque terminal id', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'studio-pty-'))
    const pty = new FakePty()
    const spawn: PtySpawner = vi.fn(() => pty)
    const manager = new TerminalManager({ spawn, platform: 'linux', env: { SHELL: '/bin/bash' } })
    const data = vi.fn()
    const exited = vi.fn()
    manager.on('data', data)
    manager.on('exit', exited)

    const started = await manager.start({ cwd, cols: 80, rows: 24 })
    expect(started.id).toMatch(/^terminal-[A-Za-z0-9_-]+$/)
    expect(started.shell).toBe('/bin/bash')
    pty.emit('data', 'hello')
    expect(data).toHaveBeenCalledWith({ id: started.id, data: Array.from(Buffer.from('hello')) })

    manager.write({ id: started.id, data: [0xe4, 0xbd, 0xa0] })
    manager.resize({ id: started.id, cols: 120, rows: 40 })
    expect(pty.writes).toEqual([Buffer.from([0xe4, 0xbd, 0xa0]).toString()])
    expect(pty.resizes).toEqual([[120, 40]])

    pty.emit('exit', { exitCode: 0, signal: 15 })
    expect(exited).toHaveBeenCalledWith({ id: started.id, code: 0, signal: '15' })
    expect(() => manager.write({ id: started.id, data: [1] })).toThrow(/not found/i)
  })

  it('validates cwd, dimensions, ids, and bounded byte input', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'studio-pty-validation-'))
    const manager = new TerminalManager({ spawn: () => new FakePty(), maxInputBytes: 4 })

    await expect(manager.start({ cwd: path.join(cwd, 'missing'), cols: 80, rows: 24 })).rejects.toMatchObject({ code: 'TERMINAL_CWD_INVALID' })
    await expect(manager.start({ cwd, cols: 1, rows: 24 })).rejects.toMatchObject({ code: 'TERMINAL_DIMENSIONS_INVALID' })
    const started = await manager.start({ cwd, cols: 80, rows: 24 })
    expect(() => manager.resize({ id: '../../bad', cols: 80, rows: 24 })).toThrow(/terminal id/i)
    expect(() => manager.write({ id: started.id, data: [0, 1, 2, 3, 4] })).toThrow(/too large/i)
    expect(() => manager.write({ id: started.id, data: [256] })).toThrow(/byte/i)
  })

  it('stops individual terminals idempotently and cleans every PTY on shutdown', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'studio-pty-cleanup-'))
    const ptys: FakePty[] = []
    const manager = new TerminalManager({ spawn: () => {
      const pty = new FakePty()
      ptys.push(pty)
      return pty
    } })
    const first = await manager.start({ cwd, cols: 80, rows: 24 })
    await manager.start({ cwd, cols: 80, rows: 24 })

    manager.stop(first.id)
    manager.stop(first.id)
    expect(ptys[0]?.killed).toBe(true)
    expect(ptys[1]?.killed).toBe(false)

    manager.shutdown()
    expect(ptys[1]?.killed).toBe(true)
    expect(manager.size).toBe(0)
  })

  it('does not retain a PTY that exits synchronously while listeners are registered', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'studio-pty-early-exit-'))
    const pty = new ImmediateExitPty()
    const manager = new TerminalManager({ spawn: () => pty })
    const exited = vi.fn()
    manager.on('exit', exited)

    const started = await manager.start({ cwd, cols: 80, rows: 24 })

    expect(manager.size).toBe(0)
    expect(pty.disposed).toBe(2)
    expect(exited).toHaveBeenCalledWith({ id: started.id, code: 127, signal: null })
  })

  it('preserves user environment but removes Studio sidecar secrets and npm/color noise', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'studio-pty-env-'))
    const spawn = vi.fn<PtySpawner>(() => new FakePty())
    const manager = new TerminalManager({
      spawn,
      env: {
        SHELL: '/bin/zsh',
        OPENAI_API_KEY: 'user-owned-key',
        HERMES_HOME: '/home/user/.hermes',
        DESKTOP_BACKEND_TOKEN: 'sidecar-secret',
        DESKTOP_WORKSPACE_GRANT_TOKEN: 'grant-secret',
        VITE_SIDECAR_TOKEN: 'vite-secret',
        npm_config_prefix: '/npm',
        NO_COLOR: '1',
      },
    })

    await manager.start({ cwd, cols: 80, rows: 24 })
    const environment = spawn.mock.calls[0]?.[2]?.env
    expect(environment.OPENAI_API_KEY).toBe('user-owned-key')
    expect(environment.HERMES_HOME).toBe('/home/user/.hermes')
    expect(environment.DESKTOP_BACKEND_TOKEN).toBeUndefined()
    expect(environment.DESKTOP_WORKSPACE_GRANT_TOKEN).toBeUndefined()
    expect(environment.VITE_SIDECAR_TOKEN).toBeUndefined()
    expect(environment.npm_config_prefix).toBeUndefined()
    expect(environment.NO_COLOR).toBeUndefined()
  })

  it('decodes UTF-8 input across write boundaries and finalizes pending input on stop', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'studio-pty-streaming-utf8-'))
    const pty = new FakePty()
    const manager = new TerminalManager({ spawn: () => pty })
    const started = await manager.start({ cwd, cols: 80, rows: 24 })

    manager.write({ id: started.id, data: [0xe4] })
    expect(pty.writes).toEqual([])
    manager.write({ id: started.id, data: [0xbd, 0xa0] })
    expect(pty.writes).toEqual(['你'])
    manager.write({ id: started.id, data: [0xe4] })
    manager.stop(started.id)
    expect(pty.writes).toEqual(['你', '�'])
  })
})
