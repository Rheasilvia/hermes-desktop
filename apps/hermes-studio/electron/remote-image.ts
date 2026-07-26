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

// Default-deny list from the IANA IPv4 Special-Purpose Address Registry,
// supplemented with multicast. Last reconciled with the 2025-10-09 registry.
// https://www.iana.org/assignments/iana-ipv4-special-registry/
const SPECIAL_IPV4_PREFIXES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.31.196.0', 24],
  ['192.52.193.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const

function ipv4MatchesPrefix(value: number, network: string, prefixLength: number): boolean {
  const networkValue = ipv4Number(network)
  if (networkValue === undefined) return false
  return (value >>> (32 - prefixLength)) === (networkValue >>> (32 - prefixLength))
}

function isPublicIpv4(address: string): boolean {
  const value = ipv4Number(address)
  if (value === undefined) return false
  return !SPECIAL_IPV4_PREFIXES.some(([network, prefixLength]) => (
    ipv4MatchesPrefix(value, network, prefixLength)
  ))
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

// Default-deny list from the IANA IPv6 Special-Purpose Address Registry,
// supplemented with legacy transition/site-local and multicast prefixes.
// Last reconciled with the 2025-10-09 registry.
// https://www.iana.org/assignments/iana-ipv6-special-registry/
const SPECIAL_IPV6_PREFIXES = [
  ['::', 96], // IPv4-compatible addresses, including unspecified and loopback.
  ['::ffff:0:0', 96], // IPv4-mapped addresses.
  ['::ffff:0:0:0', 96], // IPv4-translated addresses.
  ['64:ff9b::', 96], // NAT64 well-known prefix.
  ['64:ff9b:1::', 48], // NAT64 local-use prefix.
  ['100::', 64], // Discard-only.
  ['100:0:0:1::', 64], // Dummy IPv6 prefix.
  ['2001::', 23], // IETF protocol assignments, including Teredo and benchmarking.
  ['2001:db8::', 32], // Documentation.
  ['2002::', 16], // 6to4 transition addresses.
  ['2620:4f:8000::', 48], // Direct Delegation AS112 service.
  ['3fff::', 20], // Documentation.
  ['5f00::', 16], // Segment Routing SIDs.
  ['fc00::', 7], // Unique-local.
  ['fe80::', 10], // Link-local.
  ['fec0::', 10], // Deprecated site-local.
  ['ff00::', 8], // Multicast.
] as const

function ipv6MatchesPrefix(value: bigint, network: string, prefixLength: number): boolean {
  const networkValue = parseIpv6(network)
  if (networkValue === undefined) return false
  const shift = 128n - BigInt(prefixLength)
  return (value >> shift) === (networkValue >> shift)
}

function isPublicIpv6(address: string): boolean {
  const value = parseIpv6(address)
  if (value === undefined) return false
  // IANA currently allocates globally routable unicast space from 2000::/3.
  // Reject everything outside it so future/syntactically-valid space is not
  // accidentally treated as public until deliberately reviewed.
  if (!ipv6MatchesPrefix(value, '2000::', 3)) return false
  return !SPECIAL_IPV6_PREFIXES.some(([network, prefixLength]) => (
    ipv6MatchesPrefix(value, network, prefixLength)
  ))
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
