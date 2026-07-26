import type {
  NativeAppState,
  NativeNotificationOptions,
  NativePlatform,
  NativeWindowState,
  SidecarInfo,
  TerminalStartOptions,
} from '../src/shared/native-bridge.js'
import { IPC_CHANNELS } from '../src/shared/native-bridge.js'
import type { AssetRegistry, SessionAssetStore } from './assets.js'
import type { ClipboardImages } from './clipboard-images.js'
import type { HermesHomeFiles } from './hermes-home.js'
import { registerValidatedHandler, type IpcEventLike, type IpcMainLike } from './ipc-router.js'
import { nativeError } from './native-errors.js'
import type { NotificationManager } from './notification-manager.js'
import type { SystemOperations } from './system-ops.js'
import type { TerminalManager } from './terminal-manager.js'
import { expectRecord, expectSessionId, expectString } from './validation.js'

export interface BridgeAppLike {
  isPackaged: boolean
  getVersion(): string
}

export interface BridgeWindowLike {
  isDestroyed(): boolean
  isFocused(): boolean
  isMaximized(): boolean
  isMinimized(): boolean
  minimize(): void
  maximize(): void
  unmaximize(): void
  close(): void
  focus(): void
  show(): void
}

export interface BridgeSidecarLike {
  readonly info: SidecarInfo | undefined
  restart(): Promise<SidecarInfo>
}

export interface NativeBridgeMainOptions {
  ipcMain: IpcMainLike
  isTrustedSender: (event: IpcEventLike) => boolean
  app: BridgeAppLike
  platform?: NodeJS.Platform
  getWindow: () => BridgeWindowLike | undefined
  sidecar: BridgeSidecarLike
  hermesHome: HermesHomeFiles
  selectWorkspaceForSession: (sessionId: string) => Promise<string>
  clipboard: ClipboardImages
  assetRegistry: AssetRegistry
  assetStore: SessionAssetStore
  terminal: TerminalManager
  system: SystemOperations
  notifications: NotificationManager
}

function noArguments(payload: unknown): undefined {
  if (payload !== undefined && payload !== null) throw nativeError('INVALID_ARGUMENT', 'This operation does not accept arguments')
  return undefined
}

function recordArguments(payload: unknown): Record<string, unknown> {
  return expectRecord(payload)
}

function windowOrThrow(options: NativeBridgeMainOptions): BridgeWindowLike {
  const window = options.getWindow()
  if (!window || window.isDestroyed()) throw nativeError('WINDOW_UNAVAILABLE', 'Hermes Studio window is unavailable')
  return window
}

function platformName(platform: NodeJS.Platform): NativePlatform {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  return 'linux'
}

function currentWindowState(window: BridgeWindowLike): NativeWindowState {
  return { focused: window.isFocused(), maximized: window.isMaximized(), minimized: window.isMinimized() }
}

export function registerNativeBridge(options: NativeBridgeMainOptions): void {
  const register = <TInput, TOutput>(
    channel: string,
    parse: (payload: unknown) => TInput,
    handle: (input: TInput, event: IpcEventLike) => TOutput | Promise<TOutput>,
  ) => registerValidatedHandler(options.ipcMain, channel, {
    isTrustedSender: options.isTrustedSender,
    parse,
    handle,
  })

  register(IPC_CHANNELS.app.version, noArguments, () => options.app.getVersion())
  register(IPC_CHANNELS.app.platform, noArguments, () => platformName(options.platform ?? process.platform))
  register(IPC_CHANNELS.app.nativeState, noArguments, (): NativeAppState => {
    const window = windowOrThrow(options)
    return { isPackaged: options.app.isPackaged, focused: window.isFocused(), maximized: window.isMaximized() }
  })

  register(IPC_CHANNELS.backend.info, noArguments, () => {
    const info = options.sidecar.info
    if (!info) throw nativeError('BACKEND_NOT_READY', 'Hermes Studio backend is not ready')
    return info
  })
  register(IPC_CHANNELS.backend.restart, noArguments, () => options.sidecar.restart())

  register(IPC_CHANNELS.hermesHome.path, noArguments, () => options.hermesHome.getPath())
  register(IPC_CHANNELS.hermesHome.readText, recordArguments, ({ path }) => options.hermesHome.readText(path))
  register(IPC_CHANNELS.hermesHome.writeText, recordArguments, async ({ path, content }) => {
    await options.hermesHome.writeText(path, content)
  })
  register(IPC_CHANNELS.hermesHome.list, recordArguments, ({ path }) => options.hermesHome.list(path))

  register(IPC_CHANNELS.workspace.selectForSession, recordArguments, ({ sessionId }) =>
    options.selectWorkspaceForSession(expectSessionId(sessionId)))

  register(IPC_CHANNELS.clipboard.readImage, noArguments, () => options.clipboard.read())
  register(IPC_CHANNELS.clipboard.copyRemoteImage, recordArguments, async ({ url }) => {
    await options.clipboard.copyRemote(url)
  })

  register(IPC_CHANNELS.assets.persistSessionImage, recordArguments, ({ sessionId, sourcePath }) =>
    options.assetStore.persist(sessionId, sourcePath))
  register(IPC_CHANNELS.assets.urlForPath, recordArguments, ({ path }) =>
    options.assetRegistry.issue(expectString(path, 'path', { min: 1, max: 8_192 })))

  register(IPC_CHANNELS.terminal.start, recordArguments, ({ cwd, cols, rows }) =>
    options.terminal.start({
      cwd: cwd == null ? null : expectString(cwd, 'cwd', { min: 1, max: 8_192 }),
      cols: cols as number,
      rows: rows as number,
    } satisfies TerminalStartOptions))
  register(IPC_CHANNELS.terminal.write, recordArguments, ({ id, data }) => {
    options.terminal.write({ id, data })
  })
  register(IPC_CHANNELS.terminal.resize, recordArguments, ({ id, cols, rows }) => {
    options.terminal.resize({ id, cols, rows })
  })
  register(IPC_CHANNELS.terminal.stop, recordArguments, ({ id }) => {
    options.terminal.stop(id)
  })

  register(IPC_CHANNELS.window.minimize, noArguments, () => windowOrThrow(options).minimize())
  register(IPC_CHANNELS.window.toggleMaximize, noArguments, () => {
    const window = windowOrThrow(options)
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  register(IPC_CHANNELS.window.close, noArguments, () => windowOrThrow(options).close())
  register(IPC_CHANNELS.window.startDrag, noArguments, () => {
    throw nativeError('WINDOW_DRAG_REGION_REQUIRED', 'Electron window dragging requires a trusted CSS drag region')
  })
  register(IPC_CHANNELS.window.focus, noArguments, () => {
    const window = windowOrThrow(options)
    window.show()
    window.focus()
  })
  register(IPC_CHANNELS.window.state, noArguments, () => currentWindowState(windowOrThrow(options)))

  register(IPC_CHANNELS.system.openExternal, recordArguments, async ({ url }) => {
    await options.system.openExternal(url)
  })
  register(IPC_CHANNELS.system.installMacosCommandLineTools, noArguments, () =>
    options.system.installMacosCommandLineTools())

  register(IPC_CHANNELS.notifications.show, recordArguments, (input) =>
    options.notifications.show(input as unknown as NativeNotificationOptions))
}
