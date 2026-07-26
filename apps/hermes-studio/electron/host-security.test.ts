// @vitest-environment node
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  STUDIO_SCHEMES,
  configureSessionSecurity,
  createAppProtocolResponse,
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

  it('requires the exact trusted main-frame webContents and rejects video explicitly', () => {
    let requestHandler: ((webContents: unknown, permission: string, callback: (allowed: boolean) => void, details: { requestingUrl?: string; securityOrigin?: string; mediaTypes?: string[]; isMainFrame?: boolean }) => void) | undefined
    let checkHandler: ((webContents: unknown, permission: string, origin: string, details: { securityOrigin?: string; mediaType?: string; isMainFrame?: boolean }) => boolean) | undefined
    const trustedWebContents = {}
    const session: SessionSecurityLike = {
      setPermissionRequestHandler: (handler) => { requestHandler = handler },
      setPermissionCheckHandler: (handler) => { checkHandler = handler },
      webRequest: { onHeadersReceived: vi.fn() },
    }
    configureSessionSecurity(session, {
      platform: 'linux',
      getTrustedWebContents: () => trustedWebContents,
      getBackendOrigin: () => 'http://127.0.0.1:43123',
    })
    const callback = vi.fn()

    requestHandler?.(trustedWebContents, 'media', callback, { requestingUrl: 'hermes-studio://app/', securityOrigin: 'hermes-studio://app', mediaTypes: ['audio'], isMainFrame: true })
    requestHandler?.({}, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: ['audio'], isMainFrame: true })
    requestHandler?.(trustedWebContents, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: ['video'], isMainFrame: true })
    requestHandler?.(trustedWebContents, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: ['audio', 'video'], isMainFrame: true })
    requestHandler?.(trustedWebContents, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: ['audio'], isMainFrame: false })
    requestHandler?.(trustedWebContents, 'notifications', callback, { requestingUrl: 'hermes-studio://app/', isMainFrame: true })
    expect(callback.mock.calls.map(([allowed]) => allowed)).toEqual([true, false, false, false, false, false])
    expect(checkHandler?.(trustedWebContents, 'media', 'hermes-studio://app/', { mediaType: 'audio', isMainFrame: true })).toBe(true)
    expect(checkHandler?.({}, 'media', 'hermes-studio://app/', { mediaType: 'audio', isMainFrame: true })).toBe(false)
    expect(checkHandler?.(trustedWebContents, 'media', 'hermes-studio://app/', { mediaType: 'video', isMainFrame: true })).toBe(false)
    expect(checkHandler?.(trustedWebContents, 'media', 'https://evil.example', { mediaType: 'audio', isMainFrame: true })).toBe(false)
    expect(checkHandler?.(trustedWebContents, 'media', 'hermes-studio://app/', { mediaType: 'audio', isMainFrame: false })).toBe(false)
  })

  it.each([
    ['win32', true],
    ['darwin', false],
    ['linux', false],
  ] as const)('handles Electron 40 missing, empty, and unknown media metadata on %s', (platform, expected) => {
    let requestHandler: ((webContents: unknown, permission: string, callback: (allowed: boolean) => void, details: { requestingUrl?: string; securityOrigin?: string; mediaTypes?: string[]; isMainFrame?: boolean }) => void) | undefined
    let checkHandler: ((webContents: unknown, permission: string, origin: string, details: { securityOrigin?: string; mediaType?: string; isMainFrame?: boolean }) => boolean) | undefined
    const trustedWebContents = {}
    configureSessionSecurity({
      setPermissionRequestHandler: (handler) => { requestHandler = handler },
      setPermissionCheckHandler: (handler) => { checkHandler = handler },
      webRequest: { onHeadersReceived: vi.fn() },
    }, {
      platform,
      getTrustedWebContents: () => trustedWebContents,
      getBackendOrigin: () => undefined,
    })
    const callback = vi.fn()

    for (const mediaTypes of [undefined, [], ['unknown']] as const) {
      requestHandler?.(trustedWebContents, 'media', callback, {
        requestingUrl: 'hermes-studio://app/',
        ...(mediaTypes === undefined ? {} : { mediaTypes: [...mediaTypes] }),
        isMainFrame: true,
      })
    }
    expect(callback.mock.calls.map(([allowed]) => allowed)).toEqual([expected, expected, expected])
    for (const mediaType of [undefined, '', 'unknown'] as const) {
      expect(checkHandler?.(trustedWebContents, 'media', 'hermes-studio://app/', {
        ...(mediaType === undefined ? {} : { mediaType }),
        isMainFrame: true,
      })).toBe(expected)
    }
  })

  it('does not apply the Windows missing-metadata compatibility to untrusted frames', () => {
    let requestHandler: ((webContents: unknown, permission: string, callback: (allowed: boolean) => void, details: { requestingUrl?: string; mediaTypes?: string[]; isMainFrame?: boolean }) => void) | undefined
    let checkHandler: ((webContents: unknown, permission: string, origin: string, details: { securityOrigin?: string; mediaType?: string; isMainFrame?: boolean }) => boolean) | undefined
    const trustedWebContents = {}
    configureSessionSecurity({
      setPermissionRequestHandler: (handler) => { requestHandler = handler },
      setPermissionCheckHandler: (handler) => { checkHandler = handler },
      webRequest: { onHeadersReceived: vi.fn() },
    }, {
      platform: 'win32',
      getTrustedWebContents: () => trustedWebContents,
      getBackendOrigin: () => undefined,
    })
    const callback = vi.fn()

    requestHandler?.({}, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: [], isMainFrame: true })
    requestHandler?.(trustedWebContents, 'media', callback, { requestingUrl: 'https://evil.example/', mediaTypes: ['unknown'], isMainFrame: true })
    requestHandler?.(trustedWebContents, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: [], isMainFrame: false })
    requestHandler?.(trustedWebContents, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: ['video'], isMainFrame: true })
    requestHandler?.(trustedWebContents, 'media', callback, { requestingUrl: 'hermes-studio://app/', mediaTypes: ['audio', 'video'], isMainFrame: true })
    expect(callback.mock.calls.map(([allowed]) => allowed)).toEqual([false, false, false, false, false])
    expect(checkHandler?.({}, 'media', 'hermes-studio://app/', { mediaType: 'unknown', isMainFrame: true })).toBe(false)
    expect(checkHandler?.(trustedWebContents, 'media', 'https://evil.example/', { mediaType: 'unknown', isMainFrame: true })).toBe(false)
    expect(checkHandler?.(trustedWebContents, 'media', 'hermes-studio://app/', { mediaType: 'unknown', isMainFrame: false })).toBe(false)
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

  it('makes only content-hashed renderer assets immutable', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'studio-renderer-cache-'))
    mkdirSync(path.join(root, 'assets'))
    writeFileSync(path.join(root, 'index.html'), '<html></html>')
    writeFileSync(path.join(root, 'favicon.ico'), 'icon')
    writeFileSync(path.join(root, 'assets', 'settings.json'), '{}')
    writeFileSync(path.join(root, 'assets', 'app-deadbeef.js'), 'hashed')
    writeFileSync(path.join(root, 'assets', 'runtime-HAdYrqNM.js'), 'vite-hashed')

    await expect(createAppProtocolResponse('hermes-studio://app/assets/app-deadbeef.js', root))
      .resolves.toHaveProperty('headers')
    expect((await createAppProtocolResponse('hermes-studio://app/assets/app-deadbeef.js', root)).headers.get('Cache-Control'))
      .toBe('public, max-age=31536000, immutable')
    expect((await createAppProtocolResponse('hermes-studio://app/assets/runtime-HAdYrqNM.js', root)).headers.get('Cache-Control'))
      .toBe('public, max-age=31536000, immutable')
    expect((await createAppProtocolResponse('hermes-studio://app/assets/settings.json', root)).headers.get('Cache-Control'))
      .toBe('no-cache')
    expect((await createAppProtocolResponse('hermes-studio://app/favicon.ico', root)).headers.get('Cache-Control'))
      .toBe('no-cache')
    expect((await createAppProtocolResponse('hermes-studio://app/', root)).headers.get('Cache-Control'))
      .toBe('no-cache')
    const deepLink = await createAppProtocolResponse(
      'hermes-studio://app/conversation/desktop_123?source=restart%2Fsmoke#pending',
      root,
    )
    expect(await deepLink.text()).toBe('<html></html>')
    expect(deepLink.headers.get('Content-Type')).toBe('text/html; charset=utf-8')
  })
})
