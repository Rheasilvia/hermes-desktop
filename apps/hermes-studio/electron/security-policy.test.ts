// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  buildContentSecurityPolicy,
  isAllowedExternalUrl,
  isMicrophonePermission,
  isTrustedStudioUrl,
  parseDevServerUrl,
  safeRendererAssetPath,
} from './security-policy.js'

describe('Studio security policy', () => {
  it('accepts only the packaged app origin or the exact configured dev origin', () => {
    expect(isTrustedStudioUrl('hermes-studio://app/')).toBe(true)
    expect(isTrustedStudioUrl('hermes-studio://app/assets/index.js')).toBe(true)
    expect(isTrustedStudioUrl('hermes-studio://evil/')).toBe(false)
    expect(isTrustedStudioUrl('file:///tmp/index.html')).toBe(false)
    expect(isTrustedStudioUrl('http://127.0.0.1:1420/chat', 'http://127.0.0.1:1420')).toBe(true)
    expect(isTrustedStudioUrl('http://localhost:1420/chat', 'http://127.0.0.1:1420')).toBe(false)
    expect(isTrustedStudioUrl('http://127.0.0.1:1421/chat', 'http://127.0.0.1:1420')).toBe(false)
  })

  it('rejects malformed or imprecise development server URLs', () => {
    expect(parseDevServerUrl('http://127.0.0.1:1420')).toBe('http://127.0.0.1:1420')
    expect(parseDevServerUrl('http://localhost:1420/')).toBe('http://localhost:1420')
    expect(() => parseDevServerUrl('http://0.0.0.0:1420')).toThrow(/development server/i)
    expect(() => parseDevServerUrl('https://127.0.0.1:1420')).toThrow(/development server/i)
    expect(() => parseDevServerUrl('http://127.0.0.1:1420/path')).toThrow(/development server/i)
  })

  it('allows safe external URLs and rejects script, file, credential, and remote cleartext URLs', () => {
    expect(isAllowedExternalUrl('https://example.com/path')).toBe(true)
    expect(isAllowedExternalUrl('http://127.0.0.1:1420/oauth')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost:1420/oauth')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com')).toBe(false)
    expect(isAllowedExternalUrl('https://user:pass@example.com')).toBe(false)
    expect(isAllowedExternalUrl('file:///etc/passwd')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('denies every permission except microphone from the trusted Studio origin', () => {
    expect(isMicrophonePermission('hermes-studio://app/', 'media', ['audio'])).toBe(true)
    expect(isMicrophonePermission('hermes-studio://app/', 'media', ['audio', 'video'])).toBe(false)
    expect(isMicrophonePermission('hermes-studio://app/', 'notifications', [])).toBe(false)
    expect(isMicrophonePermission('https://example.com', 'media', ['audio'])).toBe(false)
  })

  it('builds a strict CSP and a narrowly-scoped HMR exception', () => {
    const production = buildContentSecurityPolicy()
    expect(production).toContain("default-src 'self'")
    expect(production).toContain("object-src 'none'")
    expect(production).toContain("frame-ancestors 'none'")
    expect(production).toContain('hermes-studio-asset:')
    expect(production).not.toContain('*')
    expect(production).not.toContain("'unsafe-eval'")

    const development = buildContentSecurityPolicy('http://127.0.0.1:1420')
    expect(development).toContain('http://127.0.0.1:1420')
    expect(development).toContain('ws://127.0.0.1:1420')
    expect(development).toContain("'unsafe-eval'")
    expect(development).not.toContain('*')
  })

  it('maps app protocol paths without traversal or encoded separators', () => {
    expect(safeRendererAssetPath('hermes-studio://app/')).toBe('index.html')
    expect(safeRendererAssetPath('hermes-studio://app/assets/app.js')).toBe('assets/app.js')
    expect(() => safeRendererAssetPath('hermes-studio://app/%2e%2e/secret')).toThrow()
    expect(() => safeRendererAssetPath('hermes-studio://app/assets%2Fsecret')).toThrow()
    expect(() => safeRendererAssetPath('hermes-studio://evil/index.html')).toThrow()
  })
})
