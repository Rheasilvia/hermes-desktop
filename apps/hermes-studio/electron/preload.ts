import { contextBridge, ipcRenderer } from 'electron'
import { createHermesStudioBridge } from './preload-bridge.js'

contextBridge.exposeInMainWorld('hermesStudio', createHermesStudioBridge(ipcRenderer))
