// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/native-bridge.js'
import { registerNativeBridge, type NativeBridgeMainOptions } from './native-bridge-main.js'
import { IpcAdmissionController, type IpcEventLike, type IpcMainLike } from './ipc-router.js'
import { runNativeCleanup } from './shutdown-coordinator.js'

describe('native bridge shutdown admission', () => {
  it('drains terminal, asset, and attachment handlers before sweeping their resources', async () => {
    const handlers = new Map<string, (event: IpcEventLike, payload: unknown) => Promise<unknown> | unknown>()
    const ipcMain: IpcMainLike = { handle: (channel, handler) => { handlers.set(channel, handler) } }
    const admission = new IpcAdmissionController()
    const resources = {
      terminals: new Set<string>(),
      assets: new Set<string>(),
      attachments: new Set<string>(),
    }
    let stagingClosed = false
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let started = 0
    const waitThen = async <T>(operation: () => T): Promise<T> => {
      started += 1
      await gate
      return operation()
    }
    const terminalStart = vi.fn(() => waitThen(() => {
      resources.terminals.add('terminal-abcdefgh')
      return { id: 'terminal-abcdefgh', pid: 1, shell: '/bin/sh', cwd: '/', reused: false }
    }))
    const persistAsset = vi.fn(() => waitThen(() => {
      resources.assets.add('/asset.png')
      return { path: '/asset.png', url: 'hermes-studio-asset://asset/opaque' }
    }))
    const selectAttachments = vi.fn(() => waitThen(() => {
      resources.attachments.add('/staged/image.png')
      return [{ kind: 'image' as const, path: '/staged/image.png', name: 'image.png' }]
    }))

    registerNativeBridge({
      ipcMain,
      admission,
      isTrustedSender: () => true,
      app: { isPackaged: true, getVersion: () => '1.0.0' },
      getWindow: () => undefined,
      sidecar: { info: undefined, restart: vi.fn() },
      hermesHome: {},
      selectWorkspaceForSession: vi.fn(),
      selectAttachments,
      importDroppedFiles: vi.fn(),
      clipboard: {},
      assetRegistry: {},
      assetStore: { persist: persistAsset },
      terminal: { start: terminalStart },
      system: {},
      notifications: {},
    } as unknown as NativeBridgeMainOptions)

    const invoke = (channel: string, payload?: unknown): Promise<unknown> => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`Missing handler ${channel}`)
      return Promise.resolve(handler({}, payload))
    }
    const inFlight = [
      invoke(IPC_CHANNELS.terminal.start, { cwd: '/', cols: 80, rows: 24 }),
      invoke(IPC_CHANNELS.assets.persistSessionImage, { sessionId: 'desktop_1', sourcePath: '/clip.png' }),
      invoke(IPC_CHANNELS.workspace.selectAttachments, { sessionId: 'desktop_1', kind: 'image', multiple: true }),
    ]
    await vi.waitFor(() => expect(started).toBe(3))

    const cleanup = runNativeCleanup({
      closeAndDrainIpc: () => admission.closeAndDrain(),
      saveWindowState: vi.fn(),
      shutdownTerminals: () => resources.terminals.clear(),
      shutdownNotifications: vi.fn(),
      clearAssetHandles: () => resources.assets.clear(),
      clearWorkspaceGrants: vi.fn(),
      closeAttachmentStaging: () => { stagingClosed = true },
      stopSidecar: vi.fn(),
    })

    await expect(invoke(IPC_CHANNELS.terminal.start, { cwd: '/', cols: 80, rows: 24 })).resolves.toEqual({
      ok: false,
      error: { code: 'IPC_SHUTTING_DOWN', message: 'Native bridge is shutting down' },
    })
    expect(resources.terminals.size + resources.assets.size + resources.attachments.size).toBe(0)

    release()
    await Promise.all(inFlight)
    await cleanup
    expect(resources.terminals.size + resources.assets.size).toBe(0)
    expect(resources.attachments).toEqual(new Set(['/staged/image.png']))
    expect(stagingClosed).toBe(true)

    for (const [channel, payload] of [
      [IPC_CHANNELS.terminal.start, { cwd: '/', cols: 80, rows: 24 }],
      [IPC_CHANNELS.assets.persistSessionImage, { sessionId: 'desktop_1', sourcePath: '/clip.png' }],
      [IPC_CHANNELS.workspace.selectAttachments, { sessionId: 'desktop_1', kind: 'image', multiple: true }],
    ] as const) {
      await expect(invoke(channel, payload)).resolves.toMatchObject({
        ok: false,
        error: { code: 'IPC_SHUTTING_DOWN' },
      })
    }
    expect(terminalStart).toHaveBeenCalledOnce()
    expect(persistAsset).toHaveBeenCalledOnce()
    expect(selectAttachments).toHaveBeenCalledOnce()
  })
})
