import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import type {
  NativeNotificationActionEvent,
  NativeNotificationClickEvent,
  NativeNotificationContext,
  NativeNotificationOptions,
  NativeNotificationResult,
} from '../src/shared/native-bridge.js'
import { nativeError } from './native-errors.js'
import { expectString } from './validation.js'

export interface NotificationHandle {
  on(event: string, listener: (...args: any[]) => void): unknown
  show(): void
  close(): void
}

export interface ElectronNotificationOptions {
  title: string
  body: string
  actions?: Array<{ type: 'button'; text: string }>
}

export interface NotificationManagerOptions {
  platform?: NodeJS.Platform
  isSupported: () => boolean
  create: (options: ElectronNotificationOptions) => NotificationHandle
  focus: () => void
  randomBytes?: (size: number) => Buffer
}

interface ActiveNotification {
  handle: NotificationHandle
  context?: NativeNotificationContext
  actionIds: string[]
}

function validatedContext(raw: NativeNotificationContext | undefined): NativeNotificationContext | undefined {
  if (!raw) return undefined
  const context: NativeNotificationContext = {}
  if (raw.sessionId !== undefined) context.sessionId = expectString(raw.sessionId, 'notification context sessionId', { min: 1, max: 256 })
  if (raw.command !== undefined) context.command = expectString(raw.command, 'notification context command', { min: 1, max: 8_192 })
  return context
}

export class NotificationManager extends EventEmitter {
  readonly #platform: NodeJS.Platform
  readonly #isSupported: () => boolean
  readonly #create: (options: ElectronNotificationOptions) => NotificationHandle
  readonly #focus: () => void
  readonly #randomBytes: (size: number) => Buffer
  readonly #active = new Map<string, ActiveNotification>()

  constructor(options: NotificationManagerOptions) {
    super()
    this.#platform = options.platform ?? process.platform
    this.#isSupported = options.isSupported
    this.#create = options.create
    this.#focus = options.focus
    this.#randomBytes = options.randomBytes ?? randomBytes
  }

  show(raw: NativeNotificationOptions): NativeNotificationResult {
    if (!this.#isSupported()) throw nativeError('NOTIFICATIONS_UNAVAILABLE', 'Native notifications are not supported on this system')
    const title = expectString(raw.title, 'notification title', { min: 1, max: 256 })
    const body = expectString(raw.body, 'notification body', { max: 4_096 })
    const requestedActions = raw.actions ?? []
    if (!Array.isArray(requestedActions) || requestedActions.length > 2) {
      throw nativeError('INVALID_ARGUMENT', 'notifications support at most two actions')
    }
    const actions = requestedActions.map((action) => ({
      id: expectString(action.id, 'notification action id', { min: 1, max: 64 }),
      title: expectString(action.title, 'notification action title', { min: 1, max: 128 }),
    }))
    if (new Set(actions.map((action) => action.id)).size !== actions.length) {
      throw nativeError('INVALID_ARGUMENT', 'notification action ids must be unique')
    }
    const actionsSupported = actions.length > 0 && this.#platform === 'darwin'
    const handle = this.#create({
      title,
      body,
      ...(actionsSupported
        ? { actions: actions.map((action) => ({ type: 'button' as const, text: action.title })) }
        : {}),
    })
    const id = `notification-${this.#randomBytes(18).toString('base64url')}`
    const context = validatedContext(raw.context)
    this.#active.set(id, { handle, context, actionIds: actions.map((action) => action.id) })
    handle.on('click', () => {
      this.#focus()
      const event: NativeNotificationClickEvent = { id, ...(context ? { context } : {}) }
      this.emit('click', event)
    })
    handle.on('action', (_event: unknown, index: number) => {
      const actionId = actions[index]?.id
      if (!actionId) return
      this.#focus()
      const event: NativeNotificationActionEvent = { id, actionId, ...(context ? { context } : {}) }
      this.emit('action', event)
    })
    handle.on('close', () => this.#active.delete(id))
    handle.show()
    return { id, actionsSupported }
  }

  shutdown(): void {
    const active = [...this.#active.values()]
    this.#active.clear()
    for (const entry of active) {
      try { entry.handle.close() } catch { /* best-effort shutdown */ }
    }
  }
}
