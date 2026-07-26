import type { HermesStudioBridge } from './shared/native-bridge.js'

declare global {
  interface Window {
    readonly hermesStudio?: HermesStudioBridge
  }
}

export {}
