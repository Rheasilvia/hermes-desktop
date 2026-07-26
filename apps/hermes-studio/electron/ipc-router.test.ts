// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  IpcAdmissionController,
  registerValidatedHandler,
  type IpcEventLike,
  type IpcMainLike,
} from './ipc-router.js'

describe('validated IPC handlers', () => {
  it('rejects untrusted senders before parsing arguments or running the handler', async () => {
    let registered: ((event: IpcEventLike, payload: unknown) => Promise<unknown> | unknown) | undefined
    const ipcMain: IpcMainLike = { handle: (_channel, handler) => { registered = handler } }
    const parse = vi.fn((value) => value)
    const handle = vi.fn(() => 'secret')
    registerValidatedHandler(ipcMain, 'studio:test', {
      admission: new IpcAdmissionController(),
      isTrustedSender: () => false,
      parse,
      handle,
    })

    const result = await registered?.({ senderFrame: { url: 'https://evil.example' } }, {})
    expect(result).toEqual({ ok: false, error: { code: 'IPC_SENDER_UNTRUSTED', message: 'IPC sender is not trusted' } })
    expect(parse).not.toHaveBeenCalled()
    expect(handle).not.toHaveBeenCalled()
  })

  it('validates arguments and returns serializable success/error envelopes', async () => {
    let registered: ((event: IpcEventLike, payload: unknown) => Promise<unknown> | unknown) | undefined
    const ipcMain: IpcMainLike = { handle: (_channel, handler) => { registered = handler } }
    registerValidatedHandler(ipcMain, 'studio:test', {
      admission: new IpcAdmissionController(),
      isTrustedSender: () => true,
      parse: (value) => {
        if (typeof value !== 'object' || value === null || !('name' in value)) throw new Error('name required')
        return value as { name: string }
      },
      handle: ({ name }) => `hello ${name}`,
    })

    await expect(registered?.({ senderFrame: { url: 'hermes-studio://app/' } }, { name: 'Hermes' }))
      .resolves.toEqual({ ok: true, value: 'hello Hermes' })
    await expect(registered?.({ senderFrame: { url: 'hermes-studio://app/' } }, {}))
      .resolves.toEqual({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid arguments' } })
  })

  it('does not expose unexpected native error details to the renderer', async () => {
    let registered: ((event: IpcEventLike, payload: unknown) => Promise<unknown> | unknown) | undefined
    const ipcMain: IpcMainLike = { handle: (_channel, handler) => { registered = handler } }
    registerValidatedHandler(ipcMain, 'studio:test', {
      admission: new IpcAdmissionController(),
      isTrustedSender: () => true,
      parse: () => undefined,
      handle: () => { throw new Error('failed at /Users/private/secret.txt') },
    })

    await expect(registered?.({}, undefined)).resolves.toEqual({
      ok: false,
      error: { code: 'NATIVE_OPERATION_FAILED', message: 'Native operation failed' },
    })
  })

  it('closes admission synchronously and drains only handlers admitted before shutdown', async () => {
    let registered: ((event: IpcEventLike, payload: unknown) => Promise<unknown> | unknown) | undefined
    let release!: () => void
    const admitted = new Promise<void>((resolve) => { release = resolve })
    const admission = new IpcAdmissionController()
    const parse = vi.fn((value) => value as { operation: string })
    const handle = vi.fn(async () => {
      await admitted
      return 'finished'
    })

    registerValidatedHandler({ handle: (_channel, handler) => { registered = handler } }, 'studio:test', {
      admission,
      isTrustedSender: () => true,
      parse,
      handle,
    })

    const inFlight = registered?.({}, { operation: 'in-flight' }) as Promise<unknown>
    await vi.waitFor(() => expect(handle).toHaveBeenCalledOnce())

    let drained = false
    const drain = admission.closeAndDrain().then(() => { drained = true })
    const rejected = await registered?.({}, { operation: 'late' })

    expect(rejected).toEqual({
      ok: false,
      error: { code: 'IPC_SHUTTING_DOWN', message: 'Native bridge is shutting down' },
    })
    expect(parse).toHaveBeenCalledOnce()
    expect(handle).toHaveBeenCalledOnce()
    expect(drained).toBe(false)

    release()
    await expect(inFlight).resolves.toEqual({ ok: true, value: 'finished' })
    await drain
    expect(drained).toBe(true)
  })
})
