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
  logReporter?: (message: string) => void
}

export interface SidecarLogIo {
  mkdir(directory: string): void
  append(file: string, contents: string): void
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
  redacted = redacted.replace(
    /(["']?Authorization["']?\s*[:=]\s*)(["'])(?:Bearer\s+)?[^"'\r\n]+\2/gi,
    '$1$2[REDACTED]$2',
  )
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

export function createSidecarLogWriter(
  logPath: string,
  secrets: readonly string[],
  io: SidecarLogIo = {
    mkdir: (directory) => mkdirSync(directory, { recursive: true }),
    append: (file, contents) => appendFileSync(file, contents, { encoding: 'utf8', mode: 0o600 }),
  },
  reportDisabled: (message: string) => void = (message) => console.warn(message),
): (line: string) => void {
  let ready = false
  let disabled = false
  return (line: string) => {
    if (disabled) return
    try {
      if (!ready) {
        io.mkdir(path.dirname(logPath))
        ready = true
      }
      io.append(logPath, `${new Date().toISOString()} ${redactSidecarLog(line, secrets)}\n`)
    } catch {
      // Logging must never interrupt process supervision. Do not echo the
      // original line to stderr/console because it may contain a secret.
      disabled = true
      try {
        reportDisabled('Hermes Studio sidecar file logging disabled')
      } catch {
        // A diagnostic reporter is best-effort and must also be fail-safe.
      }
    }
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
  #cleanup?: Promise<void>
  #cleanupChild?: ChildProcess
  #cancelBackoff?: () => void
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
    this.#log = createSidecarLogWriter(
      logPath,
      [this.token, this.#workspaceGrant],
      undefined,
      options.logReporter,
    )
  }

  get info(): SidecarInfo | undefined {
    return this.#info ? { ...this.#info } : undefined
  }

  async start(): Promise<SidecarInfo> {
    this.#stopping = false
    try {
      const info = await this.#spawnAndWait()
      this.#startHealthChecks()
      return info
    } catch (error) {
      if (!this.#stopping) this.#startBackgroundRestart('initial sidecar startup failed')
      throw error
    }
  }

  async stop(): Promise<void> {
    this.#stopping = true
    this.#cancelBackoff?.()
    if (this.#healthTimer) {
      this.#clearInterval(this.#healthTimer)
      this.#healthTimer = undefined
    }
    this.#info = undefined
    const child = this.#child
    const cleanup = child ? this.#terminateChild(child) : this.#cleanup
    const restart = this.#restart
    await Promise.allSettled([cleanup, restart].filter((work): work is Promise<void> => work !== undefined))
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
    if (this.#failureGate.record(ok)) {
      const reason = 'health probe failed three times'
      this.emit('unhealthy', { reason })
      await this.#scheduleRestart(reason)
    }
    return ok
  }

  async restart(): Promise<SidecarInfo> {
    if (this.#stopping) throw new Error('sidecar manager is stopping')
    const previousInfo = this.#info
    await this.#scheduleRestart('explicit renderer restart requested')
    if (!this.#info || this.#info === previousInfo) throw new Error('sidecar restart did not become ready')
    return { ...this.#info }
  }

  async updateSessionCwd(sessionId: string, cwd: string): Promise<string> {
    const info = this.#info
    if (!info) throw new Error('sidecar is not ready')
    if (typeof sessionId !== 'string' || sessionId.length < 1 || sessionId.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(sessionId)) {
      throw new Error('session id is invalid')
    }
    if (typeof cwd !== 'string' || cwd.length < 1 || cwd.length > 8_192 || cwd.includes('\0')) {
      throw new Error('workspace cwd is invalid')
    }
    const url = new URL(`/desktop/api/sessions/${encodeURIComponent(sessionId)}`, info.baseUrl)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await this.#fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'X-Desktop-Workspace-Grant': this.#workspaceGrant,
        },
        body: JSON.stringify({ cwd }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`workspace update failed with HTTP ${response.status}`)
      const payload = await response.json() as { cwd?: unknown }
      if (typeof payload.cwd !== 'string' || payload.cwd.length < 1) {
        throw new Error('workspace update response did not include cwd')
      }
      return payload.cwd
    } finally {
      clearTimeout(timeout)
    }
  }

  #startHealthChecks(): void {
    if (this.#healthTimer) this.#clearInterval(this.#healthTimer)
    this.#healthTimer = this.#setInterval(
      () => {
        void this.probeNow().catch((error) => {
          this.#log(`sidecar health supervision failed: ${error instanceof Error ? error.message : String(error)}`)
        })
      },
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
        this.#startBackgroundRestart('sidecar exited unexpectedly')
      })
      this.emit('ready', this.info)
      return { ...this.#info }
    } catch (error) {
      await this.#terminateChild(child)
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

  #startBackgroundRestart(reason: string): void {
    void this.#scheduleRestart(reason).catch((error) => {
      this.#log(`sidecar restart supervision failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  #terminateChild(child: ChildProcess): Promise<void> {
    if (this.#cleanupChild === child && this.#cleanup) return this.#cleanup
    if (this.#child === child) this.#child = undefined
    this.#intentionalStops.add(child)
    this.#cleanupChild = child
    const cleanup = Promise.resolve()
      .then(() => this.#terminateTree(child, this.#platform))
      .catch((error) => {
        this.#log(`failed to terminate owned sidecar tree: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        if (this.#cleanupChild === child) {
          this.#cleanupChild = undefined
          this.#cleanup = undefined
        }
      })
    this.#cleanup = cleanup
    return cleanup
  }

  async #waitForBackoff(delay: number): Promise<void> {
    let wake!: () => void
    const stopped = new Promise<void>((resolve) => { wake = resolve })
    this.#cancelBackoff = wake
    try {
      await Promise.race([this.#sleep(delay), stopped])
    } finally {
      if (this.#cancelBackoff === wake) this.#cancelBackoff = undefined
    }
  }

  async #restartAfterFailure(reason: string): Promise<void> {
    if (this.#stopping) return
    const delay = this.#restartWindow.nextDelay(this.#now())
    if (delay === undefined) {
      const error = new Error('sidecar restart cap reached (5 attempts in 60 seconds)')
      this.#log(`${reason}: ${error.message}`)
      this.emit('failed', error)
      return
    }
    this.#log(`${reason}; restarting in ${delay}ms`)
    const child = this.#child
    this.#info = undefined
    if (child) await this.#terminateChild(child)
    if (this.#stopping) return
    await this.#waitForBackoff(delay)
    if (this.#stopping) return
    try {
      await this.#spawnAndWait()
      this.#startHealthChecks()
      this.emit('restarted', this.info)
    } catch (error) {
      this.#log(`sidecar restart failed: ${error instanceof Error ? error.message : String(error)}`)
      if (this.#stopping) return
      await this.#restartAfterFailure('sidecar restart failed')
    }
  }
}
