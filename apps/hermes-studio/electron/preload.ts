import { contextBridge } from 'electron'

// The renderer continues to use its existing API surface during this scaffold
// phase. Native IPC routes are introduced in a follow-up migration task.
contextBridge.exposeInMainWorld('hermesStudio', Object.freeze({}))
