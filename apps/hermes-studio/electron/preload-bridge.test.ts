// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createHermesStudioBridge } from './preload-bridge.js'
import { IPC_CHANNELS, nativeErrorMessage, type IpcResult } from '../src/shared/native-bridge.js'

describe('preload bridge', () => {
  it('exposes only the frozen capability API and unwraps success envelopes', async () => {
    const invoke = vi.fn(async (channel: string): Promise<IpcResult<unknown>> => {
      if (channel === IPC_CHANNELS.app.version) return { ok: true, value: '1.2.3' }
      if (channel === IPC_CHANNELS.app.platform) return { ok: true, value: 'linux' }
      return { ok: true, value: undefined }
    })
    const bridge = createHermesStudioBridge({ invoke, on: () => undefined, off: () => undefined })

    await expect(bridge.app.version()).resolves.toBe('1.2.3')
    await expect(bridge.app.platform()).resolves.toBe('linux')
    await bridge.workspace.selectAttachments({ sessionId: 'desktop_1', kind: 'file', multiple: false })
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.selectAttachments, { sessionId: 'desktop_1', kind: 'file', multiple: false })
    expect(Object.keys(bridge).sort()).toEqual([
      'app', 'assets', 'backend', 'clipboard', 'hermesHome', 'notifications',
      'system', 'terminal', 'window', 'workspace',
    ])
    expect('ipcRenderer' in bridge).toBe(false)
    expect('updater' in bridge).toBe(false)
    expect('git' in bridge).toBe(false)
    expect('process' in bridge).toBe(false)
    expect(Object.isFrozen(bridge)).toBe(true)
    expect(Object.isFrozen(bridge.backend)).toBe(true)
    expect(Object.isFrozen(bridge.terminal)).toBe(true)
    expect(Object.isFrozen(bridge.app.version)).toBe(true)
    expect(Object.isFrozen(bridge.backend.onReady)).toBe(true)
  })

  it('rejects with stable cloneable native errors from failure envelopes', async () => {
    const bridge = createHermesStudioBridge({
      invoke: async () => ({ ok: false, error: { code: 'NOT_READY', message: 'Backend is not ready' } }),
      on: () => undefined,
      off: () => undefined,
    })

    const error = await bridge.backend.info().catch((failure: unknown) => failure)
    expect(error).toEqual({
      code: 'NOT_READY',
      message: 'Backend is not ready',
    })
    expect(nativeErrorMessage(error, 'fallback')).toBe('Backend is not ready')
  })

  it('returns idempotent unsubscribe functions and freezes event payloads', () => {
    let listener: ((event: unknown, payload: unknown) => void) | undefined
    const on = vi.fn((_channel: string, callback: typeof listener) => { listener = callback })
    const off = vi.fn()
    const callback = vi.fn()
    const bridge = createHermesStudioBridge({ invoke: async () => ({ ok: true, value: undefined }), on, off })

    const unsubscribe = bridge.backend.onReady(callback)
    const payload = { baseUrl: 'http://127.0.0.1:1234', token: 'api-token' }
    listener?.({}, payload)
    expect(callback).toHaveBeenCalledWith(payload)
    expect(Object.isFrozen(callback.mock.calls[0]?.[0])).toBe(true)

    unsubscribe()
    unsubscribe()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('imports real OS-dropped Files through webUtils without exposing a raw path API', async () => {
    const invoke = vi.fn(async (): Promise<IpcResult<unknown>> => ({
      ok: true,
      value: [{ kind: 'image', path: '/managed/photo.png', name: 'photo.png' }],
    }))
    const dropped = { name: 'photo.png', type: 'image/png', size: 42 } as File
    const getPathForFile = vi.fn((file: File) => file === dropped ? '/Users/example/photo.png' : '')
    const bridge = createHermesStudioBridge(
      { invoke, on: () => undefined, off: () => undefined },
      { getPathForFile },
    )

    const importing = bridge.workspace.importDroppedFiles('desktop_1', [dropped])
    expect(getPathForFile).toHaveBeenCalledWith(dropped)
    await expect(importing).resolves.toEqual([
      { kind: 'image', path: '/managed/photo.png', name: 'photo.png' },
    ])
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.workspace.importDroppedFiles, {
      sessionId: 'desktop_1',
      files: [{ path: '/Users/example/photo.png', name: 'photo.png', type: 'image/png', size: 42 }],
    })
    expect('webUtils' in bridge).toBe(false)
    expect('getPathForFile' in bridge.workspace).toBe(false)
  })

  it('rejects synthetic or empty-path dropped Files before invoking main', async () => {
    const invoke = vi.fn(async (): Promise<IpcResult<unknown>> => ({ ok: true, value: [] }))
    const bridge = createHermesStudioBridge(
      { invoke, on: () => undefined, off: () => undefined },
      { getPathForFile: () => '' },
    )

    await expect(bridge.workspace.importDroppedFiles('desktop_1', [
      { name: 'synthetic.png', type: 'image/png', size: 1 } as File,
    ])).rejects.toEqual({
      code: 'DROPPED_FILE_UNBACKED',
      message: 'Dropped file is not backed by an operating-system path',
    })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('bounds and validates dropped File metadata before path extraction or IPC', async () => {
    const invoke = vi.fn(async (): Promise<IpcResult<unknown>> => ({ ok: true, value: [] }))
    const getPathForFile = vi.fn(() => '/Users/example/file.txt')
    const bridge = createHermesStudioBridge(
      { invoke, on: () => undefined, off: () => undefined },
      { getPathForFile },
    )
    const valid = { name: 'file.txt', type: 'text/plain', size: 1 } as File

    for (const files of [
      [],
      Array.from({ length: 65 }, () => valid),
      [{ name: '', type: 'text/plain', size: 1 } as File],
      [{ name: 'file.txt', type: 1, size: 1 } as unknown as File],
      [{ name: 'file.txt', type: 'text/plain', size: 1.5 } as File],
    ]) {
      await expect(bridge.workspace.importDroppedFiles('desktop_1', files)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      })
    }
    expect(getPathForFile).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })
})
