import type { IpcEventLike } from './ipc-router.js'
import { isTrustedStudioUrl } from './security-policy.js'

export interface TrustedWindowLike {
  isDestroyed(): boolean
  webContents: {
    mainFrame: unknown
  }
}

export function isTrustedMainFrameSender(
  event: IpcEventLike,
  window: TrustedWindowLike | undefined,
  devOrigin?: string,
): boolean {
  return Boolean(
    window
    && !window.isDestroyed()
    && event.sender === window.webContents
    && event.senderFrame === window.webContents.mainFrame
    && isTrustedStudioUrl(event.senderFrame?.url ?? '', devOrigin),
  )
}
