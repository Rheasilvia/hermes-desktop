// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../src/shared/native-bridge.js'
import { registerNativeBridge, type NativeBridgeMainOptions } from './native-bridge-main.js'
import type { IpcEventLike, IpcMainLike } from './ipc-router.js'

describe('registered native capability ledger', () => {
  it('routes every retained legacy capability through the narrow high-level bridge', async () => {
    const handlers = new Map<string, (event: IpcEventLike, payload: unknown) => Promise<unknown> | unknown>()
    const ipcMain: IpcMainLike = { handle: (channel, handler) => { handlers.set(channel, handler) } }
    const window = {
      isDestroyed: () => false, isFocused: () => true, isMaximized: () => false, isMinimized: () => false,
      minimize: vi.fn(), maximize: vi.fn(), unmaximize: vi.fn(), close: vi.fn(), focus: vi.fn(), show: vi.fn(),
    }
    const services = {
      sidecar: { info: { baseUrl: 'http://127.0.0.1:43123', token: 'api' }, restart: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:43124', token: 'api' })) },
      hermesHome: { getPath: vi.fn(async () => '/home/.hermes'), readText: vi.fn(async () => 'text'), writeText: vi.fn(async () => undefined), list: vi.fn(async () => ['a']) },
      selectWorkspace: vi.fn(async () => '/workspace'),
      selectAttachments: vi.fn(async () => ['/managed/image.png']),
      clipboard: { read: vi.fn(async () => null), copyRemote: vi.fn(async () => undefined) },
      assets: { issue: vi.fn(async () => 'hermes-studio-asset://asset/opaque') },
      assetStore: { persist: vi.fn(async () => ({ path: '/asset.png', url: 'hermes-studio-asset://asset/opaque' })) },
      terminal: { start: vi.fn(async () => ({ id: 'terminal-abcdefgh', pid: 1, shell: '/bin/sh', cwd: '/', reused: false })), write: vi.fn(), resize: vi.fn(), stop: vi.fn() },
      system: { openExternal: vi.fn(async () => undefined), installMacosCommandLineTools: vi.fn(async () => undefined) },
      notifications: { show: vi.fn(() => ({ id: 'notification-id', actionsSupported: false })) },
    }
    registerNativeBridge({
      ipcMain,
      isTrustedSender: () => true,
      app: { isPackaged: true, getVersion: () => '1.2.3' },
      platform: 'linux',
      getWindow: () => window,
      sidecar: services.sidecar,
      hermesHome: services.hermesHome,
      selectWorkspaceForSession: services.selectWorkspace,
      selectAttachments: services.selectAttachments,
      clipboard: services.clipboard,
      assetRegistry: services.assets,
      assetStore: services.assetStore,
      terminal: services.terminal,
      system: services.system,
      notifications: services.notifications,
    } as unknown as NativeBridgeMainOptions)
    const invoke = async (channel: string, payload?: unknown) => {
      const handler = handlers.get(channel)
      expect(handler, channel).toBeDefined()
      return await handler?.({ senderFrame: { url: 'hermes-studio://app/' } }, payload)
    }

    await expect(invoke(IPC_CHANNELS.app.version)).resolves.toEqual({ ok: true, value: '1.2.3' })
    await expect(invoke(IPC_CHANNELS.app.platform)).resolves.toEqual({ ok: true, value: 'linux' })
    await expect(invoke(IPC_CHANNELS.app.nativeState)).resolves.toMatchObject({ ok: true, value: { isPackaged: true } })
    await expect(invoke(IPC_CHANNELS.backend.info)).resolves.toMatchObject({ ok: true, value: { token: 'api' } })
    await invoke(IPC_CHANNELS.backend.restart)
    await invoke(IPC_CHANNELS.hermesHome.path)
    await invoke(IPC_CHANNELS.hermesHome.readText, { path: 'config.yaml' })
    await invoke(IPC_CHANNELS.hermesHome.writeText, { path: 'config.yaml', content: 'x' })
    await invoke(IPC_CHANNELS.hermesHome.list, { path: '.' })
    await invoke(IPC_CHANNELS.workspace.selectForSession, { sessionId: 'desktop_1' })
    await expect(invoke(IPC_CHANNELS.workspace.selectAttachments, { sessionId: 'desktop_1', kind: 'image', multiple: true }))
      .resolves.toEqual({ ok: true, value: ['/managed/image.png'] })
    expect(services.selectAttachments).toHaveBeenCalledWith({ sessionId: 'desktop_1', kind: 'image', multiple: true })
    await expect(invoke(IPC_CHANNELS.workspace.selectAttachments, {
      sessionId: 'desktop_1', kind: 'anything', multiple: true,
    })).resolves.toMatchObject({ ok: false, error: { code: 'ATTACHMENT_KIND_INVALID' } })
    await expect(invoke(IPC_CHANNELS.workspace.selectAttachments, {
      sessionId: '../escape', kind: 'file', multiple: false,
    })).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_SESSION_ID' } })
    await invoke(IPC_CHANNELS.clipboard.readImage)
    await invoke(IPC_CHANNELS.clipboard.copyRemoteImage, { url: 'https://example.com/image.png' })
    await invoke(IPC_CHANNELS.assets.persistSessionImage, { sessionId: 'desktop_1', sourcePath: '/clip.png' })
    await invoke(IPC_CHANNELS.assets.urlForPath, { path: '/asset.png' })
    await invoke(IPC_CHANNELS.terminal.start, { cwd: '/', cols: 80, rows: 24 })
    await invoke(IPC_CHANNELS.terminal.write, { id: 'terminal-abcdefgh', data: [1] })
    await invoke(IPC_CHANNELS.terminal.resize, { id: 'terminal-abcdefgh', cols: 100, rows: 40 })
    await invoke(IPC_CHANNELS.terminal.stop, { id: 'terminal-abcdefgh' })
    await invoke(IPC_CHANNELS.window.minimize)
    await invoke(IPC_CHANNELS.window.toggleMaximize)
    await invoke(IPC_CHANNELS.window.close)
    await invoke(IPC_CHANNELS.window.focus)
    await invoke(IPC_CHANNELS.window.state)
    await expect(invoke(IPC_CHANNELS.window.startDrag)).resolves.toMatchObject({ ok: false, error: { code: 'WINDOW_DRAG_REGION_REQUIRED' } })
    await invoke(IPC_CHANNELS.system.openExternal, { url: 'https://example.com' })
    await invoke(IPC_CHANNELS.system.installMacosCommandLineTools)
    await invoke(IPC_CHANNELS.notifications.show, { title: 'x', body: 'y' })

    expect(handlers.has('studio:updater:check')).toBe(false)
    expect(handlers.has('studio:git:checkout')).toBe(false)
    expect(handlers.has('studio:workspace:list-children')).toBe(false)
    expect(handlers.has('studio:process:spawn')).toBe(false)
  })
})
