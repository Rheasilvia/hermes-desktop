import { EventEmitter, once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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

  it('redacts quoted JSON and Python-like Authorization values', () => {
    const json = redactSidecarLog('headers={"Authorization": "Bearer upstream-secret"}')
    const python = redactSidecarLog("headers={'Authorization': 'Bearer python-secret'}")

    expect(json).toBe('headers={"Authorization": "[REDACTED]"}')
    expect(python).toBe("headers={'Authorization': '[REDACTED]'}")
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

  it('disables a failing log sink without throwing or echoing secrets', () => {
    const append = vi.fn()
    const reporter = vi.fn()
    const mkdirFailure = createSidecarLogWriter('/invalid/log', ['secret'], {
      mkdir: () => { throw new Error('read only') },
      append,
    }, reporter)
    expect(() => mkdirFailure('Authorization: Bearer secret')).not.toThrow()
    expect(() => mkdirFailure('Authorization: Bearer another-secret')).not.toThrow()
    expect(append).not.toHaveBeenCalled()
    expect(reporter).toHaveBeenCalledOnce()
    expect(reporter).toHaveBeenCalledWith('Hermes Studio sidecar file logging disabled')
    expect(JSON.stringify(reporter.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(reporter.mock.calls)).not.toContain('read only')

    const appendFailure = vi.fn(() => { throw new Error('disk full') })
    const writer = createSidecarLogWriter('/invalid/log', ['secret'], {
      mkdir: vi.fn(),
      append: appendFailure,
    }, () => { throw new Error('reporter unavailable') })
    expect(() => writer('token=secret')).not.toThrow()
    expect(() => writer('token=secret-again')).not.toThrow()
    expect(appendFailure).toHaveBeenCalledTimes(1)
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
  it('hides the packaged Windows daemon while preserving piped READY stdout', async () => {
    let observedCommand = ''
    let observedOptions: SpawnOptions | undefined
    const spawnProcess = vi.fn((command: string, _args: readonly string[], options: SpawnOptions) => {
      observedCommand = command
      observedOptions = options
      const child = fakeChild(18_000)
      queueMicrotask(() => child.stdout?.emit('data', 'READY 45180\n'))
      return child
    }) as unknown as typeof import('node:child_process').spawn
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: true, platform: 'win32',
      env: { HERMES_HOME: '/tmp/hermes-studio-windows-ready-test' },
      spawnProcess,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })

    await expect(manager.start()).resolves.toMatchObject({ baseUrl: 'http://127.0.0.1:45180' })
    expect(observedCommand).toMatch(/sidecar[\\/]daemon\.exe$/)
    expect(observedOptions).toMatchObject({
      windowsHide: true,
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: expect.objectContaining({ DESKTOP_BACKEND_PORT: '0' }),
    })
    await manager.stop()
  })

  it('keeps startup, probes, and restart supervision alive when log I/O fails', async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'hermes-studio-log-io-test-'))
    const invalidHome = path.join(temporary, 'not-a-directory')
    writeFileSync(invalidHome, 'blocked')
    let spawned = 0
    const logReporter = vi.fn()
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: invalidHome },
      spawnProcess: vi.fn(() => {
        const child = fakeChild(19_000 + spawned)
        spawned += 1
        queueMicrotask(() => {
          child.stderr?.emit('data', 'headers={"Authorization": "Bearer must-not-fallback"}\n')
          child.stdout?.emit('data', `READY ${45_000 + spawned}\n`)
        })
        return child
      }) as unknown as typeof import('node:child_process').spawn,
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
      sleep: async () => undefined,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
      logReporter,
    })
    try {
      await expect(manager.start()).resolves.toMatchObject({ baseUrl: 'http://127.0.0.1:45001' })
      await manager.probeNow()
      await manager.probeNow()
      await expect(manager.probeNow()).resolves.toBe(false)
      expect(spawned).toBe(2)
      expect(logReporter).toHaveBeenCalledOnce()
      await manager.stop()
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  })

  it('recovers in the background after the initial child exits before READY', async () => {
    const retryDelay = deferred()
    const children: ChildProcess[] = []
    const spawnProcess = vi.fn(() => {
      const child = fakeChild(20_000 + children.length)
      children.push(child)
      if (children.length === 1) {
        queueMicrotask(() => {
          Object.assign(child, { exitCode: 1 })
          child.emit('exit', 1, null)
        })
      } else {
        queueMicrotask(() => child.stdout?.emit('data', 'READY 45201\n'))
      }
      return child
    }) as unknown as typeof import('node:child_process').spawn
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-initial-exit-test' },
      spawnProcess,
      sleep: async () => retryDelay.promise,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })

    await expect(manager.start()).rejects.toThrow('sidecar exited before READY')
    const recovered = once(manager, 'restarted')
    retryDelay.resolve()
    await recovered

    expect(spawnProcess).toHaveBeenCalledTimes(2)
    expect(manager.info?.baseUrl).toBe('http://127.0.0.1:45201')
    await manager.stop()
  })

  it('recovers in the background after the initial READY timeout', async () => {
    const retryDelay = deferred()
    let attempts = 0
    const spawnProcess = vi.fn(() => {
      const child = fakeChild(21_000 + attempts)
      attempts += 1
      if (attempts > 1) queueMicrotask(() => child.stdout?.emit('data', 'READY 45202\n'))
      return child
    }) as unknown as typeof import('node:child_process').spawn
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-initial-timeout-test' },
      spawnProcess,
      sleep: async () => retryDelay.promise,
      readyTimeoutMs: 5,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })

    await expect(manager.start()).rejects.toThrow('timed out waiting for READY')
    const recovered = once(manager, 'restarted')
    retryDelay.resolve()
    await recovered

    expect(spawnProcess).toHaveBeenCalledTimes(2)
    expect(manager.info?.baseUrl).toBe('http://127.0.0.1:45202')
    await manager.stop()
  })

  it('recovers in the background when the initial spawn throws synchronously', async () => {
    const retryDelay = deferred()
    let attempts = 0
    const spawnProcess = vi.fn(() => {
      attempts += 1
      if (attempts === 1) throw new Error('spawn unavailable')
      const child = fakeChild(22_000)
      queueMicrotask(() => child.stdout?.emit('data', 'READY 45203\n'))
      return child
    }) as unknown as typeof import('node:child_process').spawn
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-initial-spawn-test' },
      spawnProcess,
      sleep: async () => retryDelay.promise,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })

    await expect(manager.start()).rejects.toThrow('spawn unavailable')
    const recovered = once(manager, 'restarted')
    retryDelay.resolve()
    await recovered

    expect(spawnProcess).toHaveBeenCalledTimes(2)
    expect(manager.info?.baseUrl).toBe('http://127.0.0.1:45203')
    await manager.stop()
  })

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

  it('waits for in-flight restart cleanup on stop and never respawns', async () => {
    const cleanup = deferred()
    const backoff = deferred()
    const sleep = vi.fn(async () => backoff.promise)
    let spawned = 0
    const terminateTree = vi.fn(async () => cleanup.promise)
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-stop-race-test' },
      spawnProcess: vi.fn(() => {
        const child = fakeChild(30_000 + spawned)
        spawned += 1
        queueMicrotask(() => child.stdout?.emit('data', `READY ${46_000 + spawned}\n`))
        return child
      }) as unknown as typeof import('node:child_process').spawn,
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
      sleep,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree,
    })
    await manager.start()
    await manager.probeNow()
    await manager.probeNow()
    const restartingProbe = manager.probeNow()
    await vi.waitFor(() => expect(terminateTree).toHaveBeenCalledTimes(1))

    let stopResolved = false
    const stopping = manager.stop().then(() => { stopResolved = true })
    await Promise.resolve()
    expect(stopResolved).toBe(false)
    expect(spawned).toBe(1)

    cleanup.resolve()
    await vi.waitFor(() => expect(stopResolved).toBe(true), { timeout: 200 })
    await Promise.all([restartingProbe, stopping])
    expect(stopResolved).toBe(true)
    expect(sleep).not.toHaveBeenCalled()
    expect(spawned).toBe(1)
  })

  it('wakes a deferred restart backoff on stop without respawning', async () => {
    const backoff = deferred()
    const sleep = vi.fn(async () => backoff.promise)
    let spawned = 0
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-stop-backoff-test' },
      spawnProcess: vi.fn(() => {
        const child = fakeChild(32_000 + spawned)
        spawned += 1
        queueMicrotask(() => child.stdout?.emit('data', `READY ${48_000 + spawned}\n`))
        return child
      }) as unknown as typeof import('node:child_process').spawn,
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
      sleep,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })
    await manager.start()
    await manager.probeNow()
    await manager.probeNow()
    const restartingProbe = manager.probeNow()
    await vi.waitFor(() => expect(sleep).toHaveBeenCalledOnce())

    await manager.stop()
    await restartingProbe

    expect(spawned).toBe(1)
    expect(manager.info).toBeUndefined()
  })

  it('stops a replacement waiting for READY without another backoff', async () => {
    const replacementCleanup = deferred()
    const children: ChildProcess[] = []
    const sleep = vi.fn(async () => undefined)
    const terminateTree = vi.fn(async (child: ChildProcess) => {
      if (child !== children[1]) return
      await replacementCleanup.promise
      Object.assign(child, { exitCode: 1 })
      child.emit('exit', 1, null)
    })
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-stop-ready-test' },
      spawnProcess: vi.fn(() => {
        const child = fakeChild(33_000 + children.length)
        children.push(child)
        if (children.length === 1) queueMicrotask(() => child.stdout?.emit('data', 'READY 49001\n'))
        return child
      }) as unknown as typeof import('node:child_process').spawn,
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
      sleep,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree,
    })
    await manager.start()
    await manager.probeNow()
    await manager.probeNow()
    const restartingProbe = manager.probeNow()
    await vi.waitFor(() => expect(children).toHaveLength(2))

    let stopped = false
    const stopping = manager.stop().then(() => { stopped = true })
    await vi.waitFor(() => expect(terminateTree).toHaveBeenCalledWith(children[1], 'linux'))
    expect(stopped).toBe(false)
    replacementCleanup.resolve()
    await Promise.all([stopping, restartingProbe])

    expect(stopped).toBe(true)
    expect(children).toHaveLength(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(manager.info).toBeUndefined()
  })

  it('restarts after an unexpected exit immediately after READY handoff', async () => {
    const children: ChildProcess[] = []
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-ready-handoff-test' },
      spawnProcess: vi.fn(() => {
        const child = fakeChild(31_000 + children.length)
        children.push(child)
        queueMicrotask(() => child.stdout?.emit('data', `READY ${47_000 + children.length}\n`))
        return child
      }) as unknown as typeof import('node:child_process').spawn,
      sleep: async () => undefined,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })
    await manager.start()
    const restarted = once(manager, 'restarted')
    Object.assign(children[0], { exitCode: 1 })
    children[0].emit('exit', 1, null)
    await restarted

    expect(children).toHaveLength(2)
    expect(manager.info?.baseUrl).toBe('http://127.0.0.1:47002')
    await manager.stop()
  })
})

describe('native bridge sidecar operations', () => {
  it('PATCHes session cwd with API auth and the private workspace grant', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = []
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-workspace-patch-test' },
      spawnProcess: vi.fn(() => {
        const child = fakeChild(51_001)
        queueMicrotask(() => child.stdout?.emit('data', 'READY 51001\n'))
        return child
      }) as unknown as typeof import('node:child_process').spawn,
      fetch: vi.fn(async (input, init) => {
        requests.push({ url: String(input), init })
        return new Response(JSON.stringify({ cwd: '/workspace/selected' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }),
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })
    await manager.start()

    await expect(manager.updateSessionCwd('desktop_abc/../../config', '/workspace/selected'))
      .resolves.toBe('/workspace/selected')

    const request = requests[0]
    expect(request?.url).toBe('http://127.0.0.1:51001/desktop/api/sessions/desktop_abc%2F..%2F..%2Fconfig')
    expect(request?.init?.method).toBe('PATCH')
    const headers = new Headers(request?.init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${manager.token}`)
    expect(headers.get('x-desktop-workspace-grant')).toBeTruthy()
    expect(headers.get('x-desktop-workspace-grant')).not.toBe(manager.token)
    expect(request?.init?.body).toBe(JSON.stringify({ cwd: '/workspace/selected' }))
    expect(JSON.stringify(manager.info)).not.toContain(headers.get('x-desktop-workspace-grant'))
    await manager.stop()
  })

  it('emits unhealthy and supports an explicit bounded restart without exposing the grant', async () => {
    let port = 52_000
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-manual-restart-test' },
      spawnProcess: vi.fn(() => {
        const child = fakeChild(port)
        const readyPort = port
        port += 1
        queueMicrotask(() => child.stdout?.emit('data', `READY ${readyPort}\n`))
        return child
      }) as unknown as typeof import('node:child_process').spawn,
      fetch: vi.fn(async () => new Response(null, { status: 503 })),
      sleep: async () => undefined,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })
    const unhealthy = vi.fn()
    manager.on('unhealthy', unhealthy)
    await manager.start()
    await manager.probeNow()
    await manager.probeNow()
    await manager.probeNow()
    expect(unhealthy).toHaveBeenCalledWith({ reason: 'health probe failed three times' })

    const info = await manager.restart()
    expect(info.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:52\d{3}$/)
    expect(Object.keys(info)).toEqual(['baseUrl', 'token'])
    await manager.stop()
  })

  it('rejects an explicit restart when the rolling restart cap is exhausted', async () => {
    let port = 53_000
    const manager = new SidecarManager({
      appRoot: '/studio', resourcesPath: '/resources', isPackaged: false, platform: 'linux',
      env: { HERMES_HOME: '/tmp/hermes-studio-restart-cap-test' },
      spawnProcess: vi.fn(() => {
        const child = fakeChild(port)
        const readyPort = port++
        queueMicrotask(() => child.stdout?.emit('data', `READY ${readyPort}\n`))
        return child
      }) as unknown as typeof import('node:child_process').spawn,
      now: () => 1_000,
      sleep: async () => undefined,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval,
      terminateTree: async () => undefined,
    })
    await manager.start()
    for (let index = 0; index < 5; index += 1) await manager.restart()

    await expect(manager.restart()).rejects.toThrow(/did not become ready/i)
    expect(manager.info?.baseUrl).toBe('http://127.0.0.1:53005')
    await manager.stop()
  })
})
