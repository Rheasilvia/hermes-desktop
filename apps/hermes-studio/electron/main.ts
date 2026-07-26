import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { SidecarManager } from './sidecar-manager.js'

const devServerUrl = process.env.HERMES_STUDIO_DEV_SERVER
let sidecar: SidecarManager | undefined
let quitting = false

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(app.getAppPath(), 'dist', 'electron', 'preload.cjs'),
    },
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
    return
  }

  void window.loadFile(path.join(app.getAppPath(), 'dist', 'renderer', 'index.html'))
}

app.whenReady().then(async () => {
  sidecar = new SidecarManager({
    appRoot: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  })
  try {
    await sidecar.start()
  } catch (error) {
    // A failed sidecar must not prevent the shell from opening in degraded mode.
    console.error('Hermes Studio sidecar failed to start', error)
  }
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', (event) => {
  if (!sidecar || quitting) return
  event.preventDefault()
  quitting = true
  void sidecar.stop().finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
