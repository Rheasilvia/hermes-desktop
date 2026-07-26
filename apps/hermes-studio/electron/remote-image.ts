import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import { nativeError } from './native-errors.js'

const DEFAULT_MAX_BYTES = 32 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 20_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export interface ImageHopResponse {
  status: number
  headers: Record<string, string | undefined>
  body: AsyncIterable<Buffer>
}

export interface RemoteImageDependencies {
  resolve?: (hostname: string) => Promise<string[]>
  request?: (url: URL, pinnedAddress: string, signal: AbortSignal) => Promise<ImageHopResponse>
  maxBytes?: number
  maxRedirects?: number
  timeoutMs?: number
}

function ipv4Number(address: string): number | undefined {
  const parts = address.split('.')
  if (parts.length !== 4) return undefined
  const numbers = parts.map(Number)
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  return (((numbers[0]! << 24) >>> 0) + (numbers[1]! << 16) + (numbers[2]! << 8) + numbers[3]!) >>> 0
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address)
  if (value === undefined) return false
  const first = value >>> 24
  const second = (value >>> 16) & 0xff
  if (first === 0 || first === 10 || first === 127 || first >= 224) return false
  if (first === 100 && second >= 64 && second <= 127) return false
  if (first === 169 && second === 254) return false
  if (first === 172 && second >= 16 && second <= 31) return false
  if (first === 192 && (second === 168 || second === 0)) return false
  if (first === 198 && (second === 18 || second === 19 || (second === 51 && ((value >>> 8) & 0xff) === 100))) return false
  if (first === 203 && second === 0 && ((value >>> 8) & 0xff) === 113) return false
  return !(first === 192 && second === 0 && ((value >>> 8) & 0xff) === 2)
}

function parseIpv6(address: string): bigint | undefined {
  const zoneIndex = address.indexOf('%')
  const unzoned = (zoneIndex >= 0 ? address.slice(0, zoneIndex) : address).toLowerCase()
  const mappedMatch = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(unzoned)
  let normalized = unzoned
  if (mappedMatch) {
    const ipv4 = ipv4Number(mappedMatch[2]!)
    if (ipv4 === undefined) return undefined
    normalized = `${mappedMatch[1]}${((ipv4 >>> 16) & 0xffff).toString(16)}:${(ipv4 & 0xffff).toString(16)}`
  }
  const halves = normalized.split('::')
  if (halves.length > 2) return undefined
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || missing < 0) return undefined
  const groups = [...left, ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined
  return groups.reduce((result, group) => (result << 16n) | BigInt(Number.parseInt(group, 16)), 0n)
}

function isPublicIpv6(address: string): boolean {
  const value = parseIpv6(address)
  if (value === undefined || value === 0n || value === 1n) return false
  if ((value >> 120n) === 0xffn) return false
  if ((value >> 121n) === 0x7en) return false // fc00::/7
  if ((value >> 118n) === 0x3fan) return false // fe80::/10
  if ((value >> 96n) === 0x20010db8n) return false
  if ((value >> 32n) === 0xffffn) {
    const ipv4 = Number(value & 0xffff_ffffn)
    return isPublicIpv4(`${ipv4 >>> 24}.${(ipv4 >>> 16) & 0xff}.${(ipv4 >>> 8) & 0xff}.${ipv4 & 0xff}`)
  }
  return true
}

export function isPublicIpAddress(address: string): boolean {
  if (isIP(address) === 4) return isPublicIpv4(address)
  if (isIP(address) === 6) return isPublicIpv6(address)
  return false
}

function validateRemoteUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw nativeError('REMOTE_IMAGE_URL_INVALID', 'Remote image URL is invalid')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 8_192) {
    throw nativeError('REMOTE_IMAGE_URL_INVALID', 'Only credential-free http/https image URLs are supported')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw nativeError('REMOTE_IMAGE_TARGET_BLOCKED', 'Remote image target is not public')
  }
  return url
}

async function defaultResolve(hostname: string): Promise<string[]> {
  const direct = hostname.replace(/^\[|\]$/g, '')
  if (isIP(direct)) return [direct]
  return (await lookup(direct, { all: true, verbatim: true })).map((entry) => entry.address)
}

async function* incomingBody(message: http.IncomingMessage): AsyncGenerator<Buffer> {
  for await (const chunk of message) yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
}

function defaultRequest(url: URL, pinnedAddress: string, signal: AbortSignal): Promise<ImageHopResponse> {
  return new Promise((resolve, reject) => {
    const requester = url.protocol === 'https:' ? https : http
    const request = requester.request({
      protocol: url.protocol,
      hostname: pinnedAddress,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { Host: url.host, Accept: 'image/*' },
      servername: url.hostname.replace(/^\[|\]$/g, ''),
      signal,
    }, (message) => {
      const headers: Record<string, string | undefined> = {}
      for (const [key, value] of Object.entries(message.headers)) {
        headers[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value
      }
      resolve({ status: message.statusCode ?? 0, headers, body: incomingBody(message) })
    })
    request.once('error', reject)
    request.end()
  })
}

export async function fetchRemoteImage(rawUrl: string, dependencies: RemoteImageDependencies = {}): Promise<Buffer> {
  const resolve = dependencies.resolve ?? defaultResolve
  const request = dependencies.request ?? defaultRequest
  const maxBytes = dependencies.maxBytes ?? DEFAULT_MAX_BYTES
  const maxRedirects = dependencies.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const visited = new Set<string>()
  let current = validateRemoteUrl(rawUrl)

  try {
    for (let redirects = 0; ; redirects += 1) {
      if (visited.has(current.href)) throw nativeError('REMOTE_IMAGE_REDIRECT_LOOP', 'Remote image redirect loop detected')
      visited.add(current.href)
      const hostname = current.hostname.replace(/^\[|\]$/g, '')
      const addresses = await resolve(hostname)
      if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
        throw nativeError('REMOTE_IMAGE_TARGET_BLOCKED', 'Remote image target resolved to a non-public address')
      }
      const response = await request(current, addresses[0]!, controller.signal)
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects >= maxRedirects) throw nativeError('REMOTE_IMAGE_REDIRECT_LIMIT', 'Remote image exceeded the redirect limit')
        const location = response.headers.location
        if (!location) throw nativeError('REMOTE_IMAGE_FETCH_FAILED', 'Remote image redirect did not include a location')
        current = validateRemoteUrl(new URL(location, current).href)
        continue
      }
      if (response.status < 200 || response.status >= 300) {
        throw nativeError('REMOTE_IMAGE_FETCH_FAILED', `Remote image request failed with HTTP ${response.status}`)
      }
      const contentType = response.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
      if (!contentType?.startsWith('image/')) {
        throw nativeError('REMOTE_IMAGE_CONTENT_TYPE', 'Remote response is not an image')
      }
      const declared = Number(response.headers['content-length'])
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw nativeError('REMOTE_IMAGE_TOO_LARGE', 'Remote image exceeds the maximum allowed size')
      }
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of response.body) {
        size += chunk.byteLength
        if (size > maxBytes) throw nativeError('REMOTE_IMAGE_TOO_LARGE', 'Remote image exceeds the maximum allowed size')
        chunks.push(Buffer.from(chunk))
      }
      return Buffer.concat(chunks, size)
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw nativeError('REMOTE_IMAGE_TIMEOUT', 'Remote image request timed out')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
