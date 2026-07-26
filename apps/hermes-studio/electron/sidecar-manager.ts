import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'

const READY_TIMEOUT_MS = 90_000
const HEALTH_INTERVAL_MS = 5_000
const HEALTH_TIMEOUT_MS = 1_500
const RESTART_WINDOW_MS = 60_000
const MAX_RESTARTS = 5
const FAILURE_THRESHOLD = 3

export interface SidecarInfo {
  baseUrl: string
  token: string
}

export interface SidecarCommand {
  command: string
  args: string[]
  cwd?: string
}

export interface SidecarPaths {
  appRoot: string
  resourcesPath: string
  isPackaged: boolean
  platform?: NodeJS.Platform
}

export interface SidecarManagerOptions extends SidecarPaths {
  env?: NodeJS.ProcessEnv
  spawnProcess?: typeof spawn
  fetch?: typeof globalThis.fetch
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
  terminateTree?: (child: ChildProcess, platform: NodeJS.Platform) => Promise<void>
  readyTimeoutMs?: number
  healthIntervalMs?: number
}

export function resolveSidecarCommand(paths: SidecarPaths): SidecarCommand {
  const platform = paths.platform ?? process.platform
  if (!paths.isPackaged) {
    return {
      command: 'uv',
      args: ['run', '--directory', 'sidecar', 'python', '-m', 'daemon'],
      cwd: paths.appRoot,
    }
  }
  return {
    command: path.join(
      paths.resourcesPath,
      'sidecar',
      platform === 'win32' ? 'daemon.exe' : 'daemon',
    ),
    args: [],
  }
}

export function generateSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function resolveHermesHome(env: NodeJS.ProcessEnv, home = homedir()): string {
  const configured = env.HERMES_HOME?.trim()
  return configured ? path.resolve(configured) : path.join(home, '.hermes')
}

export class ReadyLineParser {
  private buffer = ''

  push(chunk: string): number | undefined {
    this.buffer += chunk
    const lines = this.buffer.split(/\r?\n/)
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      const match = /^READY ([0-9]+)$/.exec(line.trim())
      if (!match) continue
      const port = Number(match[1])
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port
    }
    return undefined
  }
}

export class RestartWindow {
  private attempts: number[] = []

  constructor(
    private readonly windowMs = RESTART_WINDOW_MS,
    private readonly maximum = MAX_RESTARTS,
  ) {}

  nextDelay(now: number): number | undefined {
    this.attempts = this.attempts.filter((attempt) => now - attempt < this.windowMs)
    if (this.attempts.length >= this.maximum) return undefined
    this.attempts.push(now)
    return Math.min(1_000 * 2 ** (this.attempts.length - 1), 30_000)
  }

  get size(): number {
    return this.attempts.length
  }
}

export class ConsecutiveFailureGate {
  private failures = 0

  constructor(private readonly threshold = FAILURE_THRESHOLD) {}

  record(ok: boolean): boolean {
    if (ok) {
      this.failures = 0
      return false
    }
    this.failures += 1
    if (this.failures < this.threshold) return false
    this.failures = 0
    return true
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function redactSidecarLog(line: string, secrets: readonly string[] = []): string {
  let redacted = line
  for (const secret of secrets) {
    if (secret) redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]')
  }
  redacted = redacted.replace(/(Authorization\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
  redacted = redacted.replace(
    /(["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|backend[_-]?token|workspace[_-]?grant(?:[_-]?token)?|password|secret|token)["']?\s*[=:]\s*)[^\s,;&]+/gi,
    '$1[REDACTED]',
  )
  redacted = redacted.replace(
    /(--(?:api-key|access-token|auth-token|backend-token|workspace-grant|password|secret|token)\s+)[^\s]+/gi,
    '$1[REDACTED]',
  )
  redacted = redacted.replace(
    /([?&](?:api[_-]?key|access[_-]?token|token|password|secret)=)[^&#\s]+/gi,
    '$1[REDACTED]',
  )
  redacted = redacted.replace(/(https?:\/\/)[^@\s/]+@/gi, '$1[REDACTED]@')
  return redacted
}

export function createSidecarLogWriter(logPath: string, secrets: readonly string[]): (line: string) => void {
  mkdirSync(path.dirname(logPath), { recursive: true })
  return (line: string) => {
    appendFileSync(logPath, `${new Date().toISOString()} ${redactSidecarLog(line, secrets)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
  }
}

function waitForExit(child: ChildProcess, milliseconds: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), milliseconds)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

export async function terminateOwnedProcessTree(
  child: ChildProcess,
  platform: NodeJS.Platform = process.platform,
  kill: typeof process.kill = process.kill,
  spawnProcess: typeof spawn = spawn,
): Promise<void> {
  const pid = child.pid
  if (!pid || child.exitCode !== null || child.signalCode !== null) return

  if (platform === 'win32') {
    await new Promise<void>((resolve) => {
      const terminator = spawnProcess('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      terminator.once('error', () => resolve())
      terminator.once('exit', () => resolve())
    })
    return
  }

  try {
    kill(-pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  if (await waitForExit(child, 2_000)) return
  try {
    kill(-pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

export class SidecarManager extends EventEmitter {
  readonly token = generateSecret()
  readonly #workspaceGrant = generateSecret()
  readonly #options: SidecarManagerOptions
  readonly #env: NodeJS.ProcessEnv
  readonly #platform: NodeJS.Platform
  readonly #spawn: typeof spawn
  readonly #fetch: typeof globalThis.fetch
  readonly #now: () => number
  readonly #sleep: (milliseconds: number) => Promise<void>
  readonly #setInterval: typeof globalThis.setInterval
  readonly #clearInterval: typeof globalThis.clearInterval
  readonly #terminateTree: (child: ChildProcess, platform: NodeJS.Platform) => Promise<void>
  readonly #restartWindow = new RestartWindow()
  readonly #failureGate = new ConsecutiveFailureGate()
  readonly #log: (line: string) => void
  #child?: ChildProcess
  #info?: SidecarInfo
  #healthTimer?: ReturnType<typeof setInterval>
  #restart?: Promise<void>
  #stopping = false
  #intentionalStops = new WeakSet<ChildProcess>()

  constructor(options: SidecarManagerOptions) {
    super()
    this.#options = options
    this.#env = options.env ?? process.env
    this.#platform = options.platform ?? process.platform
    this.#spawn = options.spawnProcess ?? spawn
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#now = options.now ?? Date.now
    this.#sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.#setInterval = options.setInterval ?? globalThis.setInterval
    this.#clearInterval = options.clearInterval ?? globalThis.clearInterval
    this.#terminateTree = options.terminateTree ?? terminateOwnedProcessTree
    const logPath = path.join(resolveHermesHome(this.#env), 'logs', 'hermes-studio.log')
    this.#log = createSidecarLogWriter(logPath, [this.token, this.#workspaceGrant])
  }

  get info(): SidecarInfo | undefined {
    return this.#info ? { ...this.#info } : undefined
  }

  async start(): Promise<SidecarInfo> {
    this.#stopping = false
    const info = await this.#spawnAndWait()
    this.#startHealthChecks()
    return info
  }

  async stop(): Promise<void> {
    this.#stopping = true
    if (this.#healthTimer) {
      this.#clearInterval(this.#healthTimer)
      this.#healthTimer = undefined
    }
    const child = this.#child
    this.#child = undefined
    this.#info = undefined
    if (child) {
      this.#intentionalStops.add(child)
      await this.#terminateTree(child, this.#platform)
    }
  }

  async probeNow(): Promise<boolean> {
    const info = this.#info
    if (!info) return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS)
    let ok = false
    try {
      const response = await this.#fetch(`${info.baseUrl}/desktop/api/health`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      })
      ok = response.ok
    } catch {
      ok = false
    } finally {
      clearTimeout(timer)
    }
    if (this.#failureGate.record(ok)) await this.#scheduleRestart('health probe failed three times')
    return ok
  }

  #startHealthChecks(): void {
    if (this.#healthTimer) this.#clearInterval(this.#healthTimer)
    this.#healthTimer = this.#setInterval(
      () => void this.probeNow(),
      this.#options.healthIntervalMs ?? HEALTH_INTERVAL_MS,
    )
  }

  async #spawnAndWait(): Promise<SidecarInfo> {
    const command = resolveSidecarCommand(this.#options)
    const spawnOptions: SpawnOptions = {
      cwd: command.cwd,
      env: {
        ...this.#env,
        DESKTOP_BACKEND_PORT: '0',
        DESKTOP_BACKEND_TOKEN: this.token,
        DESKTOP_WORKSPACE_GRANT_TOKEN: this.#workspaceGrant,
        HERMES_HOME: resolveHermesHome(this.#env),
      },
      detached: this.#platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
    const child = this.#spawn(command.command, command.args, spawnOptions)
    this.#child = child
    let stderrBuffer = ''
    child.stderr?.on('data', (chunk) => {
      stderrBuffer += String(chunk)
      const lines = stderrBuffer.split(/\r?\n/)
      stderrBuffer = lines.pop() ?? ''
      for (const line of lines) this.#log(line)
    })
    child.stderr?.once('end', () => {
      if (stderrBuffer) this.#log(stderrBuffer)
      stderrBuffer = ''
    })

    try {
      const port = await this.#waitForReady(child)
      // READY is the only stdout protocol message. Keep draining the pipe so
      // an incidental print cannot back-pressure the long-lived sidecar.
      child.stdout?.resume()
      if (this.#child !== child || this.#stopping) throw new Error('sidecar stopped during startup')
      this.#info = { baseUrl: `http://127.0.0.1:${port}`, token: this.token }
      child.once('exit', (code, signal) => {
        if (this.#intentionalStops.has(child) || this.#stopping) return
        this.#log(`sidecar exited unexpectedly code=${String(code)} signal=${String(signal)}`)
        void this.#scheduleRestart('sidecar exited unexpectedly')
      })
      this.emit('ready', this.info)
      return { ...this.#info }
    } catch (error) {
      this.#intentionalStops.add(child)
      if (this.#child === child) this.#child = undefined
      await this.#terminateTree(child, this.#platform)
      throw error
    }
  }

  #waitForReady(child: ChildProcess): Promise<number> {
    return new Promise((resolve, reject) => {
      const parser = new ReadyLineParser()
      const timeout = setTimeout(
        () => finish(new Error('sidecar startup timed out waiting for READY')),
        this.#options.readyTimeoutMs ?? READY_TIMEOUT_MS,
      )
      const onData = (chunk: unknown) => {
        const port = parser.push(String(chunk))
        if (port !== undefined) finish(undefined, port)
      }
      const onError = (error: Error) => finish(error)
      const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
        finish(new Error(`sidecar exited before READY (code=${String(code)}, signal=${String(signal)})`))
      const finish = (error?: Error, port?: number) => {
        clearTimeout(timeout)
        child.stdout?.off('data', onData)
        child.off('error', onError)
        child.off('exit', onExit)
        if (error) reject(error)
        else resolve(port as number)
      }
      child.stdout?.on('data', onData)
      child.once('error', onError)
      child.once('exit', onExit)
    })
  }

  async #scheduleRestart(reason: string): Promise<void> {
    if (this.#stopping || this.#restart) return this.#restart
    this.#restart = this.#restartAfterFailure(reason).finally(() => {
      this.#restart = undefined
    })
    return this.#restart
  }

  async #restartAfterFailure(reason: string): Promise<void> {
    const delay = this.#restartWindow.nextDelay(this.#now())
    if (delay === undefined) {
      const error = new Error('sidecar restart cap reached (5 attempts in 60 seconds)')
      this.#log(`${reason}: ${error.message}`)
      this.emit('failed', error)
      return
    }
    this.#log(`${reason}; restarting in ${delay}ms`)
    const child = this.#child
    this.#child = undefined
    this.#info = undefined
    if (child) {
      this.#intentionalStops.add(child)
      await this.#terminateTree(child, this.#platform)
    }
    await this.#sleep(delay)
    if (this.#stopping) return
    try {
      await this.#spawnAndWait()
      this.emit('restarted', this.info)
    } catch (error) {
      this.#log(`sidecar restart failed: ${error instanceof Error ? error.message : String(error)}`)
      await this.#restartAfterFailure('sidecar restart failed')
    }
  }
}
