// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  STUDIO_SCHEMES,
  configureSessionSecurity,
  hardenWebContents,
  type SessionSecurityLike,
  type WebContentsSecurityLike,
} from './host-security.js'

describe('Electron host security wiring', () => {
  it('declares privileged schemes before app readiness without file privileges', () => {
    expect(STUDIO_SCHEMES).toEqual([
      { scheme: 'hermes-studio', privileges: expect.objectContaining({ secure: true, standard: true }) },
      { scheme: 'hermes-studio-asset', privileges: expect.objectContaining({ secure: true, standard: true }) },
    ])
    expect(STUDIO_SCHEMES.some((entry) => String(entry.scheme) === 'file')).toBe(false)
  })

  it('wires deny-by-default permissions with trusted microphone as the sole exception', () => {
    let requestHandler: ((webContents: unknown, permission: string, callback: (allowed: boolean) => void, details: { requestingUrl?: string; securityOrigin?: string; mediaTypes?: string[]; isMainFrame?: boolean }) => void) | undefined
    let checkHandler: ((webContents: unknown, permission: string, origin: string, details: { securityOrigin?: string; mediaType?: string; isMainFrame?: boolean }) => boolean) | undefined
    const session: SessionSecurityLike = {
      setPermissionRequestHandler: (handler) => { requestHandler = handler },
      setPermissionCheckHandler: (handler) => { checkHandler = handler },
      webRequest: { onHeadersReceived: vi.fn() },
    }
    configureSessionSecurity(session, { getBackendOrigin: () => 'http://127.0.0.1:43123' })
    const callback = vi.fn()

    requestHandler?.({}, 'media', callback, { requestingUrl: 'hermes-studio://app/', securityOrigin: 'hermes-studio://app', mediaTypes: ['audio'], isMainFrame: true })
    requestHandler?.({}, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: ['video'], isMainFrame: true })
    requestHandler?.({}, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: ['audio'], isMainFrame: false })
    requestHandler?.({}, 'notifications', callback, { requestingUrl: 'hermes-studio://app/', isMainFrame: true })
    expect(callback.mock.calls.map(([allowed]) => allowed)).toEqual([true, false, false, false])
    expect(checkHandler?.({}, 'media', 'hermes-studio://app/', { mediaType: 'audio', isMainFrame: true })).toBe(true)
    expect(checkHandler?.({}, 'media', 'https://evil.example', { mediaType: 'audio', isMainFrame: true })).toBe(false)
    expect(checkHandler?.({}, 'media', 'hermes-studio://app/', { mediaType: 'audio', isMainFrame: false })).toBe(false)
  })

  it('sets strict CSP, no-referrer, nosniff, and denies navigation/window/webview escape hatches', () => {
    let headersHandler: ((details: { responseHeaders?: Record<string, string[]> }, callback: (result: { responseHeaders: Record<string, string[]> }) => void) => void) | undefined
    const session: SessionSecurityLike = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: { onHeadersReceived: (handler) => { headersHandler = handler } },
    }
    configureSessionSecurity(session, { getBackendOrigin: () => 'http://127.0.0.1:43123' })
    const callback = vi.fn()
    headersHandler?.({ responseHeaders: { Server: ['test'] } }, callback)
    const headers = callback.mock.calls[0]?.[0].responseHeaders as Record<string, string[]>
    expect(headers['Content-Security-Policy']?.[0]).toContain('http://127.0.0.1:43123')
    expect(headers['Content-Security-Policy']?.[0]).toContain("frame-src 'none'")
    expect(headers['Content-Security-Policy']?.[0]).not.toContain('*')
    expect(headers['Referrer-Policy']).toEqual(['no-referrer'])
    expect(headers['X-Content-Type-Options']).toEqual(['nosniff'])

    const listeners = new Map<string, (...args: unknown[]) => void>()
    const contents: WebContentsSecurityLike = {
      on: (event, listener) => { listeners.set(event, listener) },
      setWindowOpenHandler: vi.fn(),
    }
    hardenWebContents(contents)
    const navigation = { preventDefault: vi.fn() }
    listeners.get('will-navigate')?.(navigation, 'https://evil.example')
    listeners.get('will-redirect')?.(navigation, 'file:///etc/passwd')
    listeners.get('will-attach-webview')?.(navigation)
    expect(navigation.preventDefault).toHaveBeenCalledTimes(3)
    expect(contents.setWindowOpenHandler).toHaveBeenCalledOnce()
    const openHandler = vi.mocked(contents.setWindowOpenHandler).mock.calls[0]?.[0]
    expect(openHandler?.({ url: 'https://example.com' })).toEqual({ action: 'deny' })
  })
})
