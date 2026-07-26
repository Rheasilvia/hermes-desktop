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
})
