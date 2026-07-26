export type NativePlatform = 'macos' | 'windows' | 'linux'

export interface NativeError {
  code: string
  message: string
}

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: NativeError }

export interface SidecarInfo {
  baseUrl: string
  token: string
}

export interface BackendUnhealthyEvent {
  reason: string
}

export interface NativeAppState {
  isPackaged: boolean
  focused: boolean
  maximized: boolean
}

export interface NativeWindowState {
  focused: boolean
  maximized: boolean
  minimized: boolean
}

export interface AssetReference {
  path: string
  url: string
}

export type AttachmentKind = 'file' | 'folder' | 'image'

export interface AttachmentSelectionOptions {
  sessionId: string
  kind: AttachmentKind
  multiple: boolean
}

export interface SelectedAttachment {
  kind: AttachmentKind
  path: string
  name: string
}

export interface DroppedFileDescriptor {
  path: string
  name: string
  type: string
  size: number
}

export interface ImportedDroppedFile {
  kind: 'file' | 'image'
  path: string
  name: string
}

export const MAX_DROPPED_FILES = 64

export interface TerminalStartOptions {
  cwd?: string | null
  cols: number
  rows: number
}

export interface TerminalStartResult {
  id: string
  pid: number | null
  shell: string
  cwd: string
  reused: boolean
}

export interface TerminalDataEvent {
  id: string
  data: number[]
}

export interface TerminalExitEvent {
  id: string
  code: number
  signal: string | null
}

export interface TerminalErrorEvent {
  id: string
  error: string
}

export interface NativeNotificationAction {
  id: string
  title: string
}

export interface NativeNotificationContext {
  sessionId?: string
  command?: string
}

export interface NativeNotificationOptions {
  title: string
  body: string
  actions?: NativeNotificationAction[]
  context?: NativeNotificationContext
}

export interface NativeNotificationResult {
  id: string
  actionsSupported: boolean
}

export interface NativeNotificationClickEvent {
  id: string
  context?: NativeNotificationContext
}

export interface NativeNotificationActionEvent extends NativeNotificationClickEvent {
  actionId: string
}

export type Unsubscribe = () => void

export interface HermesStudioBridge {
  app: {
    version(): Promise<string>
    platform(): Promise<NativePlatform>
    nativeState(): Promise<NativeAppState>
  }
  backend: {
    info(): Promise<SidecarInfo>
    restart(): Promise<SidecarInfo>
    onReady(callback: (event: SidecarInfo) => void): Unsubscribe
    onUnhealthy(callback: (event: BackendUnhealthyEvent) => void): Unsubscribe
    onRestarted(callback: (event: SidecarInfo) => void): Unsubscribe
    onFailed(callback: (error: NativeError) => void): Unsubscribe
  }
  hermesHome: {
    path(): Promise<string>
    readText(path: string): Promise<string>
    writeText(path: string, content: string): Promise<void>
    list(path: string): Promise<string[]>
  }
  workspace: {
    selectForSession(sessionId: string): Promise<string>
    selectAttachments(options: AttachmentSelectionOptions): Promise<SelectedAttachment[]>
    importDroppedFiles(sessionId: string, files: readonly File[]): Promise<ImportedDroppedFile[]>
  }
  clipboard: {
    readImage(): Promise<AssetReference | null>
    copyRemoteImage(url: string): Promise<void>
  }
  assets: {
    persistSessionImage(sessionId: string, sourcePath: string): Promise<AssetReference>
    urlForPath(path: string): Promise<string>
  }
  terminal: {
    start(options: TerminalStartOptions): Promise<TerminalStartResult>
    write(id: string, data: number[]): Promise<void>
    resize(id: string, cols: number, rows: number): Promise<void>
    stop(id: string): Promise<void>
    onData(callback: (event: TerminalDataEvent) => void): Unsubscribe
    onExit(callback: (event: TerminalExitEvent) => void): Unsubscribe
    onError(callback: (event: TerminalErrorEvent) => void): Unsubscribe
  }
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<void>
    close(): Promise<void>
    startDrag(): Promise<void>
    focus(): Promise<void>
    state(): Promise<NativeWindowState>
    onFocus(callback: (focused: boolean) => void): Unsubscribe
    onState(callback: (state: NativeWindowState) => void): Unsubscribe
  }
  system: {
    openExternal(url: string): Promise<void>
    installMacosCommandLineTools(): Promise<void>
  }
  notifications: {
    show(options: NativeNotificationOptions): Promise<NativeNotificationResult>
    onClick(callback: (event: NativeNotificationClickEvent) => void): Unsubscribe
    onAction(callback: (event: NativeNotificationActionEvent) => void): Unsubscribe
  }
}

export const IPC_CHANNELS = {
  app: {
    version: 'studio:app:version',
    platform: 'studio:app:platform',
    nativeState: 'studio:app:native-state',
  },
  backend: {
    info: 'studio:backend:info',
    restart: 'studio:backend:restart',
    ready: 'studio:backend:ready',
    unhealthy: 'studio:backend:unhealthy',
    restarted: 'studio:backend:restarted',
    failed: 'studio:backend:failed',
  },
  hermesHome: {
    path: 'studio:hermes-home:path',
    readText: 'studio:hermes-home:read-text',
    writeText: 'studio:hermes-home:write-text',
    list: 'studio:hermes-home:list',
  },
  workspace: {
    selectForSession: 'studio:workspace:select-for-session',
    selectAttachments: 'studio:workspace:select-attachments',
    importDroppedFiles: 'studio:workspace:import-dropped-files',
  },
  clipboard: {
    readImage: 'studio:clipboard:read-image',
    copyRemoteImage: 'studio:clipboard:copy-remote-image',
  },
  assets: {
    persistSessionImage: 'studio:assets:persist-session-image',
    urlForPath: 'studio:assets:url-for-path',
  },
  terminal: {
    start: 'studio:terminal:start',
    write: 'studio:terminal:write',
    resize: 'studio:terminal:resize',
    stop: 'studio:terminal:stop',
    data: 'studio:terminal:data',
    exit: 'studio:terminal:exit',
    error: 'studio:terminal:error',
  },
  window: {
    minimize: 'studio:window:minimize',
    toggleMaximize: 'studio:window:toggle-maximize',
    close: 'studio:window:close',
    startDrag: 'studio:window:start-drag',
    focus: 'studio:window:focus',
    state: 'studio:window:state',
    focusChanged: 'studio:window:focus-changed',
    stateChanged: 'studio:window:state-changed',
  },
  system: {
    openExternal: 'studio:system:open-external',
    installMacosCommandLineTools: 'studio:system:install-macos-command-line-tools',
  },
  notifications: {
    show: 'studio:notifications:show',
    click: 'studio:notifications:click',
    action: 'studio:notifications:action',
  },
} as const
