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

export interface ValidatedHandlerOptions<TInput, TOutput> {
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
  })
}
