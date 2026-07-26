import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { buildContentSecurityPolicy, isMicrophonePermission, safeRendererAssetPath } from './security-policy.js'
import { nativeError } from './native-errors.js'
import { isPathInside } from './validation.js'

export const STUDIO_SCHEMES = [
  {
    scheme: 'hermes-studio',
    privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
  {
    scheme: 'hermes-studio-asset',
    privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
] as const

type PermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (allowed: boolean) => void,
  details: { requestingUrl?: string; securityOrigin?: string; mediaTypes?: string[]; isMainFrame?: boolean },
) => void

type PermissionCheckHandler = (
  webContents: unknown,
  permission: string,
  requestingOrigin: string,
  details: { securityOrigin?: string; mediaType?: string; isMainFrame?: boolean },
) => boolean

type HeadersHandler = (
  details: { responseHeaders?: Record<string, string[]> },
  callback: (result: { responseHeaders: Record<string, string[]> }) => void,
) => void

export interface SessionSecurityLike {
  setPermissionRequestHandler(handler: PermissionRequestHandler): void
  setPermissionCheckHandler(handler: PermissionCheckHandler): void
  webRequest: { onHeadersReceived(handler: HeadersHandler): void }
}

export interface SessionSecurityOptions {
  devOrigin?: string
  getBackendOrigin: () => string | undefined
}

export function configureSessionSecurity(session: SessionSecurityLike, options: SessionSecurityOptions): void {
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const requestingOrigin = details.securityOrigin ?? details.requestingUrl ?? ''
    callback(details.isMainFrame === true
      && isMicrophonePermission(requestingOrigin, permission, details.mediaTypes ?? [], options.devOrigin))
  })
  session.setPermissionCheckHandler((_webContents, permission, origin, details) => {
    const mediaTypes = details.mediaType ? [details.mediaType] : []
    return details.isMainFrame === true
      && isMicrophonePermission(details.securityOrigin ?? origin, permission, mediaTypes, options.devOrigin)
  })
  session.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders: Record<string, string[]> = {}
    for (const [key, value] of Object.entries(details.responseHeaders ?? {})) {
      if (!['content-security-policy', 'referrer-policy', 'x-content-type-options'].includes(key.toLowerCase())) {
        responseHeaders[key] = value
      }
    }
    responseHeaders['Content-Security-Policy'] = [buildContentSecurityPolicy(options.devOrigin, options.getBackendOrigin())]
    responseHeaders['Referrer-Policy'] = ['no-referrer']
    responseHeaders['X-Content-Type-Options'] = ['nosniff']
    callback({ responseHeaders })
  })
}

export interface WebContentsSecurityLike {
  on(event: string, listener: (...args: any[]) => void): unknown
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): unknown
}

export function hardenWebContents(contents: WebContentsSecurityLike): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event: { preventDefault(): void }) => event.preventDefault())
  contents.on('will-redirect', (event: { preventDefault(): void }) => event.preventDefault())
  contents.on('will-attach-webview', (event: { preventDefault(): void }) => event.preventDefault())
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
}

export async function createAppProtocolResponse(rawUrl: string, rendererRoot: string): Promise<Response> {
  const relative = safeRendererAssetPath(rawUrl)
  const canonicalRoot = await realpath(rendererRoot)
  let candidate = path.join(canonicalRoot, relative)
  try {
    const metadata = await stat(candidate)
    if (!metadata.isFile()) throw new Error('not a file')
  } catch {
    if (path.extname(relative)) throw nativeError('APP_ASSET_NOT_FOUND', 'Renderer asset was not found')
    candidate = path.join(canonicalRoot, 'index.html')
  }
  const canonical = await realpath(candidate)
  if (!isPathInside(canonicalRoot, canonical)) throw nativeError('APP_PROTOCOL_PATH_INVALID', 'Renderer asset escapes the application root')
  const body = await readFile(canonical)
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': CONTENT_TYPES[path.extname(canonical).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': path.extname(canonical).toLowerCase() === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
