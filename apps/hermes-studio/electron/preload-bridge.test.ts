// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createHermesStudioBridge } from './preload-bridge.js'
import { IPC_CHANNELS, type IpcResult } from '../src/shared/native-bridge.js'

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

  it('throws stable native errors from failure envelopes', async () => {
    const bridge = createHermesStudioBridge({
      invoke: async () => ({ ok: false, error: { code: 'NOT_READY', message: 'Backend is not ready' } }),
      on: () => undefined,
      off: () => undefined,
    })

    await expect(bridge.backend.info()).rejects.toMatchObject({
      name: 'HermesStudioNativeError',
      code: 'NOT_READY',
      message: 'Backend is not ready',
    })
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
})
