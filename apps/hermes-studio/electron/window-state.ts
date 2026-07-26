import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface DisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PersistedWindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

export interface WindowLike {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

const DEFAULT_STATE: PersistedWindowState = { width: 1200, height: 800, maximized: false }
const PACKAGED_SMOKE_MARKER = 'HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE'
const PACKAGED_SMOKE_USER_DATA = 'HERMES_STUDIO_INTERNAL_PACKAGED_SMOKE_USER_DATA'

export interface StudioUserDataOptions {
  env?: Readonly<Record<string, string | undefined>>
  isPackaged?: boolean
  temporaryRoot?: string
}

function finiteInteger(value: unknown): value is number {
  return Number.isFinite(value) && Number.isInteger(value)
}

function isVisibleOnDisplay(state: Required<Pick<PersistedWindowState, 'x' | 'y' | 'width' | 'height'>>, display: DisplayBounds): boolean {
  const horizontal = Math.min(state.x + state.width, display.x + display.width) - Math.max(state.x, display.x)
  const vertical = Math.min(state.y + state.height, display.y + display.height) - Math.max(state.y, display.y)
  return horizontal >= 100 && vertical >= 100
}

export function sanitizeWindowState(raw: unknown, displays: readonly DisplayBounds[]): PersistedWindowState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_STATE }
  const value = raw as Record<string, unknown>
  const widthValid = finiteInteger(value.width) && value.width >= 900 && value.width <= 10_000
  const heightValid = finiteInteger(value.height) && value.height >= 600 && value.height <= 10_000
  const width = widthValid ? value.width as number : DEFAULT_STATE.width
  const height = heightValid ? value.height as number : DEFAULT_STATE.height
  const maximized = typeof value.maximized === 'boolean' ? value.maximized : false
  if (!widthValid || !heightValid) return { ...DEFAULT_STATE }
  if (!finiteInteger(value.x) || !finiteInteger(value.y)) return { width, height, maximized }
  const candidate = { x: value.x, y: value.y, width, height }
  if (!displays.some((display) => isVisibleOnDisplay(candidate, display))) return { width, height, maximized }
  return { ...candidate, maximized }
}

export function resolveStudioUserData(
  appDataPath: string,
  options: StudioUserDataOptions = {},
): string {
  const environment = options.env ?? {}
  const marker = environment[PACKAGED_SMOKE_MARKER]
  const override = environment[PACKAGED_SMOKE_USER_DATA]
  if (marker === undefined && override === undefined) {
    return path.join(appDataPath, 'hermes-studio-electron')
  }
  if (marker !== '1' || !override) {
    throw new Error('The packaged smoke userData override requires the internal packaged smoke marker')
  }
  if (!options.isPackaged) {
    throw new Error('The packaged smoke userData override requires a packaged application')
  }
  if (!options.temporaryRoot || !path.isAbsolute(override)) {
    throw new Error('The packaged smoke userData override must be an absolute temporary directory')
  }

  let temporaryRoot: string
  let userData: string
  try {
    temporaryRoot = realpathSync(options.temporaryRoot)
    userData = realpathSync(override)
  } catch {
    throw new Error('The packaged smoke userData override must name an existing temporary directory')
  }
  if (!statSync(userData).isDirectory()) {
    throw new Error('The packaged smoke userData override must name an existing temporary directory')
  }

  const parent = path.dirname(userData)
  const relativeParent = path.relative(temporaryRoot, parent)
  const smokeDirectory = path.basename(parent)
  const isDirectTemporaryChild = relativeParent !== ''
    && !path.isAbsolute(relativeParent)
    && path.dirname(relativeParent) === '.'
  if (
    !isDirectTemporaryChild
    || !/^hermes-studio-packaged-smoke-[A-Za-z0-9]{6,}$/.test(smokeDirectory)
    || path.basename(userData) !== 'electron-user-data'
  ) {
    throw new Error('The packaged smoke userData override must use a generated packaged smoke directory')
  }
  return userData
}

export function focusExistingWindow(window: WindowLike | undefined): boolean {
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}

export interface PersistableWindow {
  getNormalBounds(): { x: number; y: number; width: number; height: number }
  isMaximized(): boolean
  isDestroyed(): boolean
}

export class WindowStateStore {
  readonly #file: string

  constructor(userData: string) {
    this.#file = path.join(userData, 'window-state.json')
  }

  load(displays: readonly DisplayBounds[]): PersistedWindowState {
    try {
      return sanitizeWindowState(JSON.parse(readFileSync(this.#file, 'utf8')), displays)
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  save(window: PersistableWindow): void {
    if (window.isDestroyed()) return
    const state = { ...window.getNormalBounds(), maximized: window.isMaximized() }
    const directory = path.dirname(this.#file)
    mkdirSync(directory, { recursive: true })
    const temporary = `${this.#file}.tmp`
    writeFileSync(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporary, this.#file)
  }
}
