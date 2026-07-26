import {
  IPC_CHANNELS,
  type HermesStudioBridge,
  type IpcResult,
  type NativeError,
} from '../src/shared/native-bridge.js'

export interface IpcRendererLike {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): unknown
  off(channel: string, listener: (event: unknown, payload: unknown) => void): unknown
}

export class HermesStudioNativeError extends Error {
  readonly code: string

  constructor(error: NativeError) {
    super(error.message)
    this.name = 'HermesStudioNativeError'
    this.code = error.code
  }
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  const kind = typeof value
  if ((kind !== 'object' && kind !== 'function') || value === null || seen.has(value as object)) return value
  seen.add(value as object)
  for (const nested of Object.values(value as object)) deepFreeze(nested, seen)
  return Object.freeze(value)
}

export function createHermesStudioBridge(ipc: IpcRendererLike): HermesStudioBridge {
  const invoke = async <T>(channel: string, payload?: unknown): Promise<T> => {
    const result = await ipc.invoke(channel, payload) as IpcResult<T>
    if (!result || typeof result !== 'object' || !('ok' in result)) {
      throw new HermesStudioNativeError({ code: 'IPC_RESPONSE_INVALID', message: 'Native bridge returned an invalid response' })
    }
    if (!result.ok) throw new HermesStudioNativeError(result.error)
    return deepFreeze(result.value)
  }

  const subscribe = <T>(channel: string, callback: (event: T) => void): (() => void) => {
    const listener = (_event: unknown, payload: unknown) => callback(deepFreeze(payload as T))
    ipc.on(channel, listener)
    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      ipc.off(channel, listener)
    }
  }

  return deepFreeze<HermesStudioBridge>({
    app: {
      version: () => invoke(IPC_CHANNELS.app.version),
      platform: () => invoke(IPC_CHANNELS.app.platform),
      nativeState: () => invoke(IPC_CHANNELS.app.nativeState),
    },
    backend: {
      info: () => invoke(IPC_CHANNELS.backend.info),
      restart: () => invoke(IPC_CHANNELS.backend.restart),
      onReady: (callback) => subscribe(IPC_CHANNELS.backend.ready, callback),
      onUnhealthy: (callback) => subscribe(IPC_CHANNELS.backend.unhealthy, callback),
      onRestarted: (callback) => subscribe(IPC_CHANNELS.backend.restarted, callback),
      onFailed: (callback) => subscribe(IPC_CHANNELS.backend.failed, callback),
    },
    hermesHome: {
      path: () => invoke(IPC_CHANNELS.hermesHome.path),
      readText: (path) => invoke(IPC_CHANNELS.hermesHome.readText, { path }),
      writeText: (path, content) => invoke(IPC_CHANNELS.hermesHome.writeText, { path, content }),
      list: (path) => invoke(IPC_CHANNELS.hermesHome.list, { path }),
    },
    workspace: {
      selectForSession: (sessionId) => invoke(IPC_CHANNELS.workspace.selectForSession, { sessionId }),
      selectAttachments: (options) => invoke(IPC_CHANNELS.workspace.selectAttachments, options),
    },
    clipboard: {
      readImage: () => invoke(IPC_CHANNELS.clipboard.readImage),
      copyRemoteImage: (url) => invoke(IPC_CHANNELS.clipboard.copyRemoteImage, { url }),
    },
    assets: {
      persistSessionImage: (sessionId, sourcePath) => invoke(IPC_CHANNELS.assets.persistSessionImage, { sessionId, sourcePath }),
      urlForPath: (path) => invoke(IPC_CHANNELS.assets.urlForPath, { path }),
    },
    terminal: {
      start: (options) => invoke(IPC_CHANNELS.terminal.start, options),
      write: (id, data) => invoke(IPC_CHANNELS.terminal.write, { id, data }),
      resize: (id, cols, rows) => invoke(IPC_CHANNELS.terminal.resize, { id, cols, rows }),
      stop: (id) => invoke(IPC_CHANNELS.terminal.stop, { id }),
      onData: (callback) => subscribe(IPC_CHANNELS.terminal.data, callback),
      onExit: (callback) => subscribe(IPC_CHANNELS.terminal.exit, callback),
      onError: (callback) => subscribe(IPC_CHANNELS.terminal.error, callback),
    },
    window: {
      minimize: () => invoke(IPC_CHANNELS.window.minimize),
      toggleMaximize: () => invoke(IPC_CHANNELS.window.toggleMaximize),
      close: () => invoke(IPC_CHANNELS.window.close),
      startDrag: () => invoke(IPC_CHANNELS.window.startDrag),
      focus: () => invoke(IPC_CHANNELS.window.focus),
      state: () => invoke(IPC_CHANNELS.window.state),
      onFocus: (callback) => subscribe(IPC_CHANNELS.window.focusChanged, callback),
      onState: (callback) => subscribe(IPC_CHANNELS.window.stateChanged, callback),
    },
    system: {
      openExternal: (url) => invoke(IPC_CHANNELS.system.openExternal, { url }),
      installMacosCommandLineTools: () => invoke(IPC_CHANNELS.system.installMacosCommandLineTools),
    },
    notifications: {
      show: (options) => invoke(IPC_CHANNELS.notifications.show, options),
      onClick: (callback) => subscribe(IPC_CHANNELS.notifications.click, callback),
      onAction: (callback) => subscribe(IPC_CHANNELS.notifications.action, callback),
    },
  })
}
