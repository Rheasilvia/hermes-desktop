import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  Notification as ElectronNotification,
  protocol,
  screen,
  session,
  shell,
} from 'electron'
import path from 'node:path'
import * as pty from 'node-pty'
import { IPC_CHANNELS, type NativeWindowState, type SidecarInfo } from '../src/shared/native-bridge.js'
import { AssetRegistry, SessionAssetStore, createAssetProtocolResponse } from './assets.js'
import { ClipboardImages } from './clipboard-images.js'
import { HermesHomeFiles } from './hermes-home.js'
import {
  STUDIO_SCHEMES,
  configureSessionSecurity,
  createAppProtocolResponse,
  hardenWebContents,
  type SessionSecurityLike,
} from './host-security.js'
import { registerNativeBridge } from './native-bridge-main.js'
import { toNativeError } from './native-errors.js'
import { NotificationManager } from './notification-manager.js'
import { buildContentSecurityPolicy, isTrustedStudioUrl, parseDevServerUrl } from './security-policy.js'
import { SidecarManager, resolveHermesHome } from './sidecar-manager.js'
import { SystemOperations } from './system-ops.js'
import { TerminalManager } from './terminal-manager.js'
import { focusExistingWindow, resolveStudioUserData, WindowStateStore } from './window-state.js'
import { selectWorkspaceForSession, WorkspaceGrants } from './workspace-grants.js'

protocol.registerSchemesAsPrivileged([...STUDIO_SCHEMES])

const rawDevServerUrl = process.env.HERMES_STUDIO_DEV_SERVER
const devOrigin = rawDevServerUrl ? parseDevServerUrl(rawDevServerUrl) : undefined
const rendererRoot = path.join(app.getAppPath(), 'dist', 'renderer')
const userData = resolveStudioUserData(app.getPath('appData'))
app.setPath('userData', userData)

let mainWindow: BrowserWindow | undefined
let sidecar: SidecarManager | undefined
let terminal: TerminalManager | undefined
let notifications: NotificationManager | undefined
let assetRegistry: AssetRegistry | undefined
let workspaceGrants: WorkspaceGrants | undefined
let windowStateStore: WindowStateStore | undefined
let saveWindowStateTimer: ReturnType<typeof setTimeout> | undefined
let cleanupStarted = false
let rendererBackendOrigin: string | undefined

function sendToRenderer(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

function nativeWindowState(window: BrowserWindow): NativeWindowState {
  return {
    focused: window.isFocused(),
    maximized: window.isMaximized(),
    minimized: window.isMinimized(),
  }
}

function emitWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  sendToRenderer(IPC_CHANNELS.window.stateChanged, nativeWindowState(mainWindow))
}

function refreshRendererForBackend(info: SidecarInfo | undefined): void {
  if (!info || rendererBackendOrigin === info.baseUrl || !mainWindow || mainWindow.isDestroyed()) return
  rendererBackendOrigin = info.baseUrl
  // The document CSP names the exact sidecar origin. A port-zero restart gets
  // a new origin, so reload once after the lifecycle event has been delivered.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload()
  }, 100)
}

function scheduleWindowStateSave(): void {
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer)
  saveWindowStateTimer = setTimeout(() => {
    if (mainWindow && windowStateStore) windowStateStore.save(mainWindow)
  }, 250)
}

function displayBounds(): Array<{ x: number; y: number; width: number; height: number }> {
  return screen.getAllDisplays().map((display) => ({ ...display.workArea }))
}

function createWindow(): BrowserWindow {
  if (!windowStateStore) throw new Error('window state store is not initialized')
  const state = windowStateStore.load(displayBounds())
  const window = new BrowserWindow({
    ...(state.x === undefined ? {} : { x: state.x }),
    ...(state.y === undefined ? {} : { y: state.y }),
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hidden' : undefined,
    trafficLightPosition: process.platform === 'darwin' ? { x: 13, y: 18 } : undefined,
    backgroundColor: '#0a0c10',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      nodeIntegration: false,
      allowRunningInsecureContent: false,
      preload: path.join(app.getAppPath(), 'dist', 'electron', 'preload.cjs'),
    },
  })
  mainWindow = window
  hardenWebContents(window.webContents)
  window.once('ready-to-show', () => {
    window.show()
    if (state.maximized) window.maximize()
  })
  window.on('focus', () => {
    sendToRenderer(IPC_CHANNELS.window.focusChanged, true)
    emitWindowState()
  })
  window.on('blur', () => {
    sendToRenderer(IPC_CHANNELS.window.focusChanged, false)
    emitWindowState()
  })
  window.on('maximize', emitWindowState)
  window.on('unmaximize', emitWindowState)
  window.on('minimize', emitWindowState)
  window.on('restore', emitWindowState)
  window.on('move', scheduleWindowStateSave)
  window.on('resize', scheduleWindowStateSave)
  window.on('close', () => windowStateStore?.save(window))
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = undefined
  })

  rendererBackendOrigin = sidecar?.info?.baseUrl
  if (devOrigin) void window.loadURL(devOrigin)
  else void window.loadURL('hermes-studio://app/')
  return window
}

async function registerProtocols(): Promise<void> {
  protocol.handle('hermes-studio', async (request) => {
    try {
      const response = await createAppProtocolResponse(request.url, rendererRoot)
      response.headers.set('Content-Security-Policy', buildContentSecurityPolicy(undefined, sidecar?.info?.baseUrl))
      return response
    } catch {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Security-Policy': buildContentSecurityPolicy(),
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
  })
  protocol.handle('hermes-studio-asset', async (request) => {
    try {
      if (!assetRegistry) throw new Error('asset registry unavailable')
      return await createAssetProtocolResponse(request.url, assetRegistry)
    } catch {
      return new Response('Not Found', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
  })
}

function wireRuntimeEvents(): void {
  if (!sidecar || !terminal || !notifications) throw new Error('native services are not initialized')
  sidecar.on('ready', (info) => {
    sendToRenderer(IPC_CHANNELS.backend.ready, info)
    refreshRendererForBackend(info)
  })
  sidecar.on('unhealthy', (event) => sendToRenderer(IPC_CHANNELS.backend.unhealthy, event))
  sidecar.on('restarted', (info) => {
    sendToRenderer(IPC_CHANNELS.backend.restarted, info)
    refreshRendererForBackend(info)
  })
  sidecar.on('failed', (error) => sendToRenderer(IPC_CHANNELS.backend.failed, toNativeError(error, 'BACKEND_FAILED')))
  terminal.on('data', (event) => sendToRenderer(IPC_CHANNELS.terminal.data, event))
  terminal.on('exit', (event) => sendToRenderer(IPC_CHANNELS.terminal.exit, event))
  terminal.on('error', (event) => sendToRenderer(IPC_CHANNELS.terminal.error, event))
  notifications.on('click', (event) => sendToRenderer(IPC_CHANNELS.notifications.click, event))
  notifications.on('action', (event) => sendToRenderer(IPC_CHANNELS.notifications.action, event))
}

async function initialize(): Promise<void> {
  const hermesHomePath = resolveHermesHome(process.env)
  const clipboardRoot = path.join(userData, 'clipboard-assets')
  workspaceGrants = new WorkspaceGrants()
  assetRegistry = new AssetRegistry({
    allowedRoots: () => [hermesHomePath, clipboardRoot, ...(workspaceGrants?.roots() ?? [])],
  })
  const hermesHome = new HermesHomeFiles(hermesHomePath)
  const assetStore = new SessionAssetStore({
    hermesHome: hermesHomePath,
    registry: assetRegistry,
    sourceRoots: () => [hermesHomePath, clipboardRoot, ...(workspaceGrants?.roots() ?? [])],
    validateImage: (imagePath) => !nativeImage.createFromPath(imagePath).isEmpty(),
  })
  const clipboardImages = new ClipboardImages({
    managedRoot: clipboardRoot,
    registry: assetRegistry,
    readImage: () => clipboard.readImage(),
    writeImage: (image) => clipboard.writeImage(image as Electron.NativeImage),
    createImage: (bytes) => nativeImage.createFromBuffer(bytes),
  })
  terminal = new TerminalManager({
    spawn: (file, args, options) => pty.spawn(file, args, options) as unknown as import('./terminal-manager.js').PtyProcessLike,
  })
  sidecar = new SidecarManager({
    appRoot: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  })
  const system = new SystemOperations({ openExternal: (url) => shell.openExternal(url) })
  notifications = new NotificationManager({
    isSupported: () => ElectronNotification.isSupported(),
    create: (options) => new ElectronNotification(options),
    focus: () => { focusExistingWindow(mainWindow) },
  })
  windowStateStore = new WindowStateStore(userData)

  configureSessionSecurity(session.defaultSession as unknown as SessionSecurityLike, {
    devOrigin,
    getBackendOrigin: () => sidecar?.info?.baseUrl,
  })
  await registerProtocols()
  wireRuntimeEvents()
  registerNativeBridge({
    ipcMain,
    isTrustedSender: (event) => Boolean(
      mainWindow
      && !mainWindow.isDestroyed()
      && event.sender === mainWindow.webContents
      && isTrustedStudioUrl(event.senderFrame?.url ?? '', devOrigin),
    ),
    app,
    getWindow: () => mainWindow,
    sidecar,
    hermesHome,
    selectWorkspaceForSession: async (sessionId) => selectWorkspaceForSession({
      sessionId,
      grants: workspaceGrants!,
      pickDirectory: async () => {
        if (!mainWindow) return undefined
        const result = await dialog.showOpenDialog(mainWindow, {
          title: 'Select Workspace',
          properties: ['openDirectory'],
        })
        return result.canceled ? undefined : result.filePaths[0]
      },
      updateSessionCwd: (id, cwd) => sidecar!.updateSessionCwd(id, cwd),
    }),
    clipboard: clipboardImages,
    assetRegistry,
    assetStore,
    terminal,
    system,
    notifications,
  })
  createWindow()
  void sidecar.start().catch((error) => {
    sendToRenderer(IPC_CHANNELS.backend.failed, toNativeError(error, 'BACKEND_START_FAILED'))
  })
}

async function cleanup(): Promise<void> {
  if (cleanupStarted) return
  cleanupStarted = true
  if (saveWindowStateTimer) clearTimeout(saveWindowStateTimer)
  if (mainWindow && windowStateStore) windowStateStore.save(mainWindow)
  terminal?.shutdown()
  notifications?.shutdown()
  assetRegistry?.clear()
  workspaceGrants?.clear()
  await sidecar?.stop()
}

const ownsInstance = app.requestSingleInstanceLock()
if (!ownsInstance) {
  app.quit()
} else {
  app.on('second-instance', () => { focusExistingWindow(mainWindow) })
  app.whenReady().then(initialize).catch((error) => {
    console.error('Hermes Studio failed to initialize', error)
    app.quit()
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && windowStateStore) createWindow()
    else focusExistingWindow(mainWindow)
  })
  app.on('before-quit', (event) => {
    if (cleanupStarted) return
    event.preventDefault()
    void cleanup().finally(() => app.quit())
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
