import type { IpcResult } from '../src/shared/native-bridge.js'
import { NativeBridgeError, toNativeError } from './native-errors.js'

export interface IpcEventLike {
  sender?: unknown
  senderFrame?: { url?: string } | null
}

export interface IpcMainLike {
  handle(
    channel: string,
    handler: (event: IpcEventLike, payload: unknown) => Promise<unknown> | unknown,
  ): void
}

const IPC_SHUTTING_DOWN = {
  ok: false,
  error: { code: 'IPC_SHUTTING_DOWN', message: 'Native bridge is shutting down' },
} as const

export class IpcAdmissionController {
  #accepting = true
  #active = 0
  #drainPromise: Promise<void> | undefined
  #resolveDrain: (() => void) | undefined

  admit(): (() => void) | undefined {
    if (!this.#accepting) return undefined
    this.#active += 1
    let released = false
    return () => {
      if (released) return
      released = true
      this.#active -= 1
      if (!this.#accepting && this.#active === 0) {
        this.#resolveDrain?.()
        this.#resolveDrain = undefined
      }
    }
  }

  closeAndDrain(): Promise<void> {
    this.#accepting = false
    if (this.#active === 0) return Promise.resolve()
    this.#drainPromise ??= new Promise<void>((resolve) => { this.#resolveDrain = resolve })
    return this.#drainPromise
  }
}

export interface ValidatedHandlerOptions<TInput, TOutput> {
  admission: IpcAdmissionController
  isTrustedSender: (event: IpcEventLike) => boolean
  parse: (payload: unknown) => TInput
  handle: (input: TInput, event: IpcEventLike) => Promise<TOutput> | TOutput
}

export function registerValidatedHandler<TInput, TOutput>(
  ipcMain: IpcMainLike,
  channel: string,
  options: ValidatedHandlerOptions<TInput, TOutput>,
): void {
  ipcMain.handle(channel, async (event, payload): Promise<IpcResult<TOutput>> => {
    if (!options.isTrustedSender(event)) {
      return { ok: false, error: { code: 'IPC_SENDER_UNTRUSTED', message: 'IPC sender is not trusted' } }
    }
    const release = options.admission.admit()
    if (!release) return IPC_SHUTTING_DOWN
    try {
      let input: TInput
      try {
        input = options.parse(payload)
      } catch (error) {
        const normalized = error instanceof NativeBridgeError
          ? toNativeError(error)
          : { code: 'INVALID_ARGUMENT', message: 'Invalid arguments' }
        return { ok: false, error: normalized }
      }
      try {
        return { ok: true, value: await options.handle(input, event) }
      } catch (error) {
        return { ok: false, error: toNativeError(error) }
      }
    } finally {
      release()
    }
  })
}
