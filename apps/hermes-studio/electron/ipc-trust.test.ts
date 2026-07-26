// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { isTrustedMainFrameSender } from './ipc-trust.js'

describe('isTrustedMainFrameSender', () => {
  it('accepts only the exact current main frame and rejects a same-origin subframe', () => {
    const mainFrame = { url: 'hermes-studio://app/' }
    const webContents = { mainFrame }
    const window = { isDestroyed: () => false, webContents }

    expect(isTrustedMainFrameSender({ sender: webContents, senderFrame: mainFrame }, window)).toBe(true)
    expect(isTrustedMainFrameSender({
      sender: webContents,
      senderFrame: { url: 'hermes-studio://app/' },
    }, window)).toBe(false)
    expect(isTrustedMainFrameSender({ sender: {}, senderFrame: mainFrame }, window)).toBe(false)
  })
})
