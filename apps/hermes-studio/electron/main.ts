import { app, BrowserWindow } from 'electron'
import path from 'node:path'

const devServerUrl = process.env.HERMES_STUDIO_DEV_SERVER

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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
