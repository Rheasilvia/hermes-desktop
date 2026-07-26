import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { createHermesStudioBridge } from './preload-bridge.js'

contextBridge.exposeInMainWorld('hermesStudio', createHermesStudioBridge(ipcRenderer, webUtils))
