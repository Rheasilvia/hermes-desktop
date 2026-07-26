import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type {
  TerminalDataEvent,
  TerminalErrorEvent,
  TerminalExitEvent,
  TerminalStartOptions,
  TerminalStartResult,
} from '../src/shared/native-bridge.js'
import { nativeError } from './native-errors.js'

export interface DisposableLike { dispose(): void }

export interface PtyProcessLike {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  onData(listener: (data: string) => void): DisposableLike
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): DisposableLike
}

export interface PtySpawnOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string>
}

export type PtySpawner = (file: string, args: string[], options: PtySpawnOptions) => PtyProcessLike

interface TerminalSession {
  process: PtyProcessLike
  subscriptions: DisposableLike[]
}

export interface TerminalManagerOptions {
  spawn: PtySpawner
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  cwd?: () => string
  maxInputBytes?: number
  randomBytes?: (size: number) => Buffer
}

function terminalDimensions(cols: unknown, rows: unknown): { cols: number; rows: number } {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || Number(cols) < 2 || Number(cols) > 500 || Number(rows) < 2 || Number(rows) > 200) {
    throw nativeError('TERMINAL_DIMENSIONS_INVALID', 'Terminal dimensions must be integers within 2-500 columns and 2-200 rows')
  }
  return { cols: Number(cols), rows: Number(rows) }
}

function terminalId(value: unknown): string {
  if (typeof value !== 'string' || !/^terminal-[A-Za-z0-9_-]{8,}$/.test(value)) {
    throw nativeError('TERMINAL_ID_INVALID', 'Terminal id is invalid')
  }
  return value
}

function shellSpec(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): { shell: string; args: string[] } {
  const shell = platform === 'win32'
    ? (env.COMSPEC?.trim() || 'powershell.exe')
    : (env.SHELL?.trim() || '/bin/sh')
  const basename = shell.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (basename.startsWith('pwsh') || basename.startsWith('powershell')) return { shell, args: ['-NoLogo'] }
  if (basename.startsWith('cmd')) return { shell, args: [] }
  if (basename.includes('zsh') || basename.includes('bash')) return { shell, args: ['-il'] }
  return { shell, args: ['-i'] }
}

function terminalEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue
    if (['NO_COLOR', 'FORCE_COLOR', 'COLORFGBG'].includes(key)) continue
    if (key === 'npm_config_prefix' || key.startsWith('npm_config_') || key.startsWith('npm_package_')) continue
    result[key] = value
  }
  return {
    ...result,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Hermes Studio',
    HERMES_DESKTOP_TERMINAL: '1',
  }
}

export class TerminalManager extends EventEmitter {
  readonly #spawn: PtySpawner
  readonly #platform: NodeJS.Platform
  readonly #env: NodeJS.ProcessEnv
  readonly #cwd: () => string
  readonly #maxInputBytes: number
  readonly #randomBytes: (size: number) => Buffer
  readonly #sessions = new Map<string, TerminalSession>()

  constructor(options: TerminalManagerOptions) {
    super()
    this.#spawn = options.spawn
    this.#platform = options.platform ?? process.platform
    this.#env = options.env ?? process.env
    this.#cwd = options.cwd ?? process.cwd
    this.#maxInputBytes = options.maxInputBytes ?? 1024 * 1024
    this.#randomBytes = options.randomBytes ?? randomBytes
  }

  get size(): number { return this.#sessions.size }

  async start(options: TerminalStartOptions): Promise<TerminalStartResult> {
    const { cols, rows } = terminalDimensions(options.cols, options.rows)
    const requestedCwd = options.cwd?.trim() || this.#cwd()
    let cwd: string
    try {
      cwd = await realpath(path.resolve(requestedCwd))
      if (!(await stat(cwd)).isDirectory()) throw new Error('not a directory')
    } catch {
      throw nativeError('TERMINAL_CWD_INVALID', 'Terminal cwd was not found or is not a directory')
    }
    const { shell, args } = shellSpec(this.#platform, this.#env)
    let processHandle: PtyProcessLike
    try {
      processHandle = this.#spawn(shell, args, {
        name: 'xterm-256color', cols, rows, cwd, env: terminalEnvironment(this.#env),
      })
    } catch (error) {
      throw nativeError('TERMINAL_START_FAILED', `Failed to start terminal: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
    const id = `terminal-${this.#randomBytes(18).toString('base64url')}`
    const subscriptions: DisposableLike[] = []
    subscriptions.push(processHandle.onData((data) => {
      const event: TerminalDataEvent = { id, data: Array.from(Buffer.from(data, 'utf8')) }
      this.emit('data', event)
    }))
    subscriptions.push(processHandle.onExit(({ exitCode, signal }) => {
      this.#disposeSession(id, false)
      const event: TerminalExitEvent = { id, code: exitCode, signal: signal == null ? null : String(signal) }
      this.emit('exit', event)
    }))
    this.#sessions.set(id, { process: processHandle, subscriptions })
    return { id, pid: processHandle.pid || null, shell, cwd, reused: false }
  }

  write(request: { id: unknown; data: unknown }): void {
    const session = this.#get(request.id)
    if (!Array.isArray(request.data) || request.data.length > this.#maxInputBytes) {
      throw nativeError('TERMINAL_INPUT_TOO_LARGE', 'Terminal input is too large')
    }
    if (request.data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
      throw nativeError('TERMINAL_INPUT_INVALID', 'Terminal input must contain bytes')
    }
    try {
      session.process.write(Buffer.from(request.data).toString('utf8'))
    } catch (error) {
      const message = `Terminal write failed: ${error instanceof Error ? error.message : 'unknown error'}`
      const event: TerminalErrorEvent = { id: request.id as string, error: message }
      this.emit('error', event)
      throw nativeError('TERMINAL_WRITE_FAILED', message)
    }
  }

  resize(request: { id: unknown; cols: unknown; rows: unknown }): void {
    const session = this.#get(request.id)
    const { cols, rows } = terminalDimensions(request.cols, request.rows)
    try {
      session.process.resize(cols, rows)
    } catch (error) {
      const message = `Terminal resize failed: ${error instanceof Error ? error.message : 'unknown error'}`
      const event: TerminalErrorEvent = { id: request.id as string, error: message }
      this.emit('error', event)
      throw nativeError('TERMINAL_RESIZE_FAILED', message)
    }
  }

  stop(rawId: unknown): void {
    const id = terminalId(rawId)
    this.#disposeSession(id, true)
  }

  shutdown(): void {
    for (const id of [...this.#sessions.keys()]) this.#disposeSession(id, true)
  }

  #get(rawId: unknown): TerminalSession {
    const id = terminalId(rawId)
    const session = this.#sessions.get(id)
    if (!session) throw nativeError('TERMINAL_NOT_FOUND', 'Terminal session not found')
    return session
  }

  #disposeSession(id: string, kill: boolean): void {
    const session = this.#sessions.get(id)
    if (!session) return
    this.#sessions.delete(id)
    for (const subscription of session.subscriptions) subscription.dispose()
    if (kill) {
      try { session.process.kill() } catch { /* best-effort shutdown */ }
    }
  }
}
