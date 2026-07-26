import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  ConsecutiveFailureGate,
  createSidecarLogWriter,
  ReadyLineParser,
  RestartWindow,
  SidecarManager,
  generateSecret,
  redactSidecarLog,
  resolveSidecarCommand,
  terminateOwnedProcessTree,
} from './sidecar-manager.js'

function fakeChild(pid: number): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    pid,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: null,
    stdio: [],
    connected: false,
    killed: false,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: '',
    kill: vi.fn(() => true),
  })
  return child
}

describe('sidecar command resolution', () => {
  it('uses the exact uv development invocation from the app root', () => {
    expect(resolveSidecarCommand({ appRoot: '/studio', resourcesPath: '/resources', isPackaged: false })).toEqual({
      command: 'uv',
      args: ['run', '--directory', 'sidecar', 'python', '-m', 'daemon'],
      cwd: '/studio',
    })
  })

  it('uses the host-native executable under Electron resources', () => {
    expect(resolveSidecarCommand({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: true, platform: 'linux',
    }).command).toBe('/resources/sidecar/daemon')
    expect(resolveSidecarCommand({
      appRoot: 'C:\\studio', resourcesPath: 'C:\\resources', isPackaged: true, platform: 'win32',
    }).command).toMatch(/sidecar[\\/]daemon\.exe$/)
  })
})

describe('sidecar protocol and secrets', () => {
  it('parses READY across chunks and rejects port zero', () => {
    const parser = new ReadyLineParser()
    expect(parser.push('noise\nREA')).toBeUndefined()
    expect(parser.push('DY 0\nREADY 4')).toBeUndefined()
    expect(parser.push('321\n')).toBe(4321)
  })

  it('generates independent high-entropy secrets', () => {
    const first = generateSecret()
    const second = generateSecret()
    expect(first.length).toBeGreaterThanOrEqual(40)
    expect(first).not.toBe(second)
  })

  it('systematically redacts known secrets, authorization, and sensitive parameters', () => {
    const secret = 'top-secret-token'
    const result = redactSidecarLog(
      `Authorization: Bearer ${secret} "api_key": "hunter2" url=http://user:pass@x/?token=query-secret --password oops`,
      [secret],
    )
    expect(result).not.toContain(secret)
    expect(result).not.toContain('hunter2')
    expect(result).not.toContain('query-secret')
    expect(result).not.toContain('oops')
    expect(result).not.toContain('user:pass')
    expect(result.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('appends redacted lines to the Hermes Studio log', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'hermes-studio-log-test-'))
    try {
      const logPath = path.join(home, 'logs', 'hermes-studio.log')
      const write = createSidecarLogWriter(logPath, ['generated-secret'])
      write('Authorization: Bearer generated-secret')
      write('token=another-secret')

      const contents = readFileSync(logPath, 'utf8')
      expect(contents).not.toContain('generated-secret')
      expect(contents).not.toContain('another-secret')
      expect(contents.split('\n').filter(Boolean)).toHaveLength(2)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('restart policy', () => {
  it('requires consecutive failures and resets after success', () => {
    const gate = new ConsecutiveFailureGate(3)
    expect(gate.record(false)).toBe(false)
    expect(gate.record(false)).toBe(false)
    expect(gate.record(true)).toBe(false)
    expect(gate.record(false)).toBe(false)
    expect(gate.record(false)).toBe(false)
    expect(gate.record(false)).toBe(true)
  })

  it('applies exponential backoff and allows at most five attempts per minute', () => {
    const ledger = new RestartWindow(60_000, 5)
    expect([0, 1, 2, 3, 4].map(() => ledger.nextDelay(1_000))).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000,
    ])
    expect(ledger.nextDelay(1_000)).toBeUndefined()
    expect(ledger.nextDelay(61_001)).toBe(1_000)
  })
})

describe('owned process lifecycle', () => {
  it('terminates only the owned Unix process group', async () => {
    const child = fakeChild(321)
    const kills: Array<[number, NodeJS.Signals | number | undefined]> = []
    const kill = vi.fn((pid: number, signal?: NodeJS.Signals | number) => {
      kills.push([pid, signal])
      Object.assign(child, { exitCode: 0 })
      return true
    })

    await terminateOwnedProcessTree(child, 'linux', kill as typeof process.kill)

    expect(kills).toEqual([[-321, 'SIGTERM']])
  })

  it('targets the owned PID when terminating a Windows tree', async () => {
    const child = fakeChild(987)
    const calls: Array<{ command: string; args: readonly string[] }> = []
    const spawnProcess = ((command: string, args: readonly string[], _options: SpawnOptions) => {
      calls.push({ command, args })
      const terminator = new EventEmitter()
      queueMicrotask(() => terminator.emit('exit', 0))
      return terminator
    }) as unknown as typeof import('node:child_process').spawn

    await terminateOwnedProcessTree(child, 'win32', process.kill, spawnProcess)

    expect(calls).toEqual([{ command: 'taskkill', args: ['/PID', '987', '/T', '/F'] }])
  })
})

describe('SidecarManager', () => {
  it('injects private, independent tokens and restarts after three failed probes', async () => {
    const children: ChildProcess[] = []
    const environments: NodeJS.ProcessEnv[] = []
    const spawnProcess = vi.fn((_command: string, _args: readonly string[], options: SpawnOptions) => {
      const child = fakeChild(7_000 + children.length)
      children.push(child)
      environments.push(options.env ?? {})
      queueMicrotask(() => child.stdout?.emit('data', `READY ${43_210 + children.length}\n`))
      return child
    }) as unknown as typeof import('node:child_process').spawn
    const delays: number[] = []
    const terminated: ChildProcess[] = []
    const manager = new SidecarManager({
      appRoot: '/studio',
      resourcesPath: '/resources',
      isPackaged: false,
      platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-manager-test' },
      spawnProcess,
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
      sleep: async (delay) => { delays.push(delay) },
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async (child) => { terminated.push(child) },
    })

    const info = await manager.start()
    expect(info.baseUrl).toBe('http://127.0.0.1:43211')
    expect(info.token).toBe(manager.token)
    expect(environments[0].DESKTOP_BACKEND_PORT).toBe('0')
    expect(environments[0].DESKTOP_BACKEND_TOKEN).toBe(manager.token)
    expect(environments[0].DESKTOP_WORKSPACE_GRANT_TOKEN).not.toBe(manager.token)
    expect(Object.keys(info)).toEqual(['baseUrl', 'token'])

    await manager.probeNow()
    await manager.probeNow()
    await manager.probeNow()
    expect(children).toHaveLength(2)
    expect(terminated).toEqual([children[0]])
    expect(delays).toEqual([1_000])

    await manager.stop()
    expect(terminated).toEqual([children[0], children[1]])
  })

  it('stops restarting after five attempts in the rolling window', async () => {
    let nextPort = 44_000
    const spawnProcess = vi.fn(() => {
      const child = fakeChild(nextPort)
      queueMicrotask(() => child.stdout?.emit('data', `READY ${nextPort++}\n`))
      return child
    }) as unknown as typeof import('node:child_process').spawn
    const failed = vi.fn()
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-manager-cap-test' },
      spawnProcess,
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
      now: () => 10_000,
      sleep: async () => undefined,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })
    manager.on('failed', failed)
    await manager.start()

    for (let attempt = 0; attempt < 6; attempt += 1) {
      await manager.probeNow()
      await manager.probeNow()
      await manager.probeNow()
    }

    expect(spawnProcess).toHaveBeenCalledTimes(6)
    expect(failed).toHaveBeenCalledTimes(1)
    await manager.stop()
  })
})
