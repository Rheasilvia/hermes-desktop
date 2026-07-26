import { nativeError } from './native-errors.js'

const DEV_HOSTS = new Set(['127.0.0.1', 'localhost'])
const CLEARTEXT_EXTERNAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

function hasNoCredentials(url: URL): boolean {
  return url.username === '' && url.password === ''
}

export function parseDevServerUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw nativeError('INVALID_DEV_SERVER', 'Hermes Studio development server URL is invalid')
  }
  if (
    url.protocol !== 'http:'
    || !DEV_HOSTS.has(url.hostname)
    || url.port !== '1420'
    || url.pathname !== '/'
    || url.search
    || url.hash
    || !hasNoCredentials(url)
  ) {
    throw nativeError('INVALID_DEV_SERVER', 'Hermes Studio development server must be http://localhost:1420 or http://127.0.0.1:1420')
  }
  return url.origin
}

export function resolveDevServerOrigin(
  environment: Readonly<Record<string, string | undefined>>,
  isPackaged: boolean,
): string | undefined {
  if (isPackaged) return undefined
  const raw = environment.HERMES_STUDIO_DEV_SERVER
  return raw ? parseDevServerUrl(raw) : undefined
}

export function isTrustedStudioUrl(raw: string, devOrigin?: string): boolean {
  try {
    const url = new URL(raw)
    if (
      url.protocol === 'hermes-studio:'
      && url.hostname === 'app'
      && url.port === ''
      && hasNoCredentials(url)
    ) return true
    return Boolean(devOrigin && (url.protocol === 'http:') && url.origin === devOrigin && hasNoCredentials(url))
  } catch {
    return false
  }
}

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (!hasNoCredentials(url)) return false
    if (url.protocol === 'https:') return true
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    return url.protocol === 'http:' && CLEARTEXT_EXTERNAL_HOSTS.has(hostname)
  } catch {
    return false
  }
}

export function isMicrophonePermission(
  requestingOrigin: string,
  permission: string,
  mediaTypes: readonly string[] = [],
  devOrigin?: string,
): boolean {
  return permission === 'media'
    && isTrustedStudioUrl(requestingOrigin, devOrigin)
    && mediaTypes.length === 1
    && mediaTypes[0] === 'audio'
}

export function buildContentSecurityPolicy(devOrigin?: string, backendOrigin?: string): string {
  const script = devOrigin
    ? `script-src 'self' ${devOrigin} 'unsafe-eval'`
    : "script-src 'self'"
  const connectSources = ["'self'"]
  if (backendOrigin) connectSources.push(backendOrigin)
  if (devOrigin) {
    connectSources.push(devOrigin)
    connectSources.push(devOrigin.replace(/^http:/, 'ws:'))
  }
  return [
    "default-src 'self'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http: hermes-studio-asset:",
    `connect-src ${connectSources.join(' ')}`,
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'",
  ].join('; ')
}

export function safeRendererAssetPath(rawUrl: string): string {
  if (/%(?:2e|2f|5c)/i.test(rawUrl)) {
    throw nativeError('APP_PROTOCOL_PATH_INVALID', 'Encoded path separators and traversal are not allowed')
  }
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw nativeError('APP_PROTOCOL_URL_INVALID', 'App protocol URL is invalid')
  }
  if (!isTrustedStudioUrl(url.toString()) || url.search || url.hash) {
    throw nativeError('APP_PROTOCOL_URL_INVALID', 'App protocol URL is not trusted')
  }
  const decoded = decodeURIComponent(url.pathname)
  const relative = decoded.replace(/^\/+/, '') || 'index.html'
  if (relative.split('/').some((segment) => segment === '..' || segment === '.')) {
    throw nativeError('APP_PROTOCOL_PATH_INVALID', 'App protocol path traversal is not allowed')
  }
  return relative
}
