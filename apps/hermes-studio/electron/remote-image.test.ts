// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { fetchRemoteImage, isPublicIpAddress, type ImageHopResponse } from './remote-image.js'

async function* body(...chunks: Buffer[]): AsyncGenerator<Buffer> {
  for (const chunk of chunks) yield chunk
}

function response(
  status: number,
  headers: Record<string, string>,
  chunks: Buffer[] = [],
): ImageHopResponse {
  return { status, headers, body: body(...chunks) }
}

describe('remote image SSRF policy', () => {
  it.each([
    ['IPv4 this-network', '0.255.255.255'],
    ['IPv4 private 10/8', '10.0.0.1'],
    ['IPv4 shared address space', '100.64.0.1'],
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv4 link-local', '169.254.1.1'],
    ['IPv4 private 172.16/12', '172.31.255.255'],
    ['IPv4 IETF protocol assignments', '192.0.0.9'],
    ['IPv4 documentation TEST-NET-1', '192.0.2.1'],
    ['IPv4 AS112-v4', '192.31.196.1'],
    ['IPv4 AMT', '192.52.193.1'],
    ['IPv4 deprecated 6to4 relay anycast', '192.88.99.1'],
    ['IPv4 private 192.168/16', '192.168.1.1'],
    ['IPv4 direct delegation AS112', '192.175.48.1'],
    ['IPv4 benchmarking', '198.18.0.1'],
    ['IPv4 documentation TEST-NET-2', '198.51.100.1'],
    ['IPv4 documentation TEST-NET-3', '203.0.113.1'],
    ['IPv4 multicast', '239.255.255.255'],
    ['IPv4 reserved', '240.0.0.1'],
    ['IPv4 limited broadcast', '255.255.255.255'],
    ['IPv6 unspecified', '::'],
    ['IPv6 loopback', '::1'],
    ['IPv4-compatible private', '::192.168.1.1'],
    ['IPv4-mapped private dotted', '::ffff:192.168.1.1'],
    ['IPv4-mapped private hexadecimal', '0:0:0:0:0:ffff:c0a8:101'],
    ['IPv4-mapped public remains special-purpose', '::ffff:93.184.216.34'],
    ['IPv4-translated private', '::ffff:0:192.168.1.1'],
    ['NAT64 well-known prefix', '64:ff9b::c0a8:101'],
    ['NAT64 local-use prefix', '64:ff9b:1::c0a8:101'],
    ['IPv6 discard-only', '100::1'],
    ['IPv6 dummy prefix', '100:0:0:1::1'],
    ['IPv6 IETF protocol assignments', '2001:1::1'],
    ['Teredo', '2001:0000:4136:e378:8000:63bf:3fff:fdd2'],
    ['IPv6 benchmarking', '2001:2::1'],
    ['IPv6 documentation', '2001:db8::1'],
    ['6to4 with embedded private IPv4', '2002:c0a8:0101::1'],
    ['IPv6 direct delegation AS112', '2620:4f:8000::1'],
    ['IPv6 documentation 3fff/20', '3fff::1'],
    ['IPv6 segment routing SIDs', '5f00::1'],
    ['IPv6 unique-local', 'fc00::1'],
    ['IPv6 deprecated site-local', 'fec0::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['IPv6 outside allocated global unicast', '4000::1'],
  ])('classifies %s address %s as non-public', (_label, address) => {
    expect(isPublicIpAddress(address)).toBe(false)
  })

  it.each([
    ['93.184.216.34'],
    ['8.8.8.8'],
    ['2606:2800:220:1:248:1893:25c8:1946'],
    ['2001:4860:4860::8888'],
  ])('accepts globally routable address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(true)
  })

  it('rejects local hostnames before making a request', async () => {
    const request = vi.fn()
    await expect(fetchRemoteImage('http://localhost/image.png', {
      resolve: async () => ['127.0.0.1'],
      request,
    })).rejects.toMatchObject({ code: 'REMOTE_IMAGE_TARGET_BLOCKED' })
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects DNS answers containing private targets and pins a public target into the request', async () => {
    const request = vi.fn(async (_url: URL, address: string) => response(200, {
      'content-type': 'image/png',
      'content-length': '3',
    }, [Buffer.from('png')]))
    await expect(fetchRemoteImage('https://mixed.example/image.png', {
      resolve: async () => ['93.184.216.34', '10.0.0.2'],
      request,
    })).rejects.toMatchObject({ code: 'REMOTE_IMAGE_TARGET_BLOCKED' })

    const bytes = await fetchRemoteImage('https://public.example/image.png', {
      resolve: async () => ['93.184.216.34'],
      request,
    })
    expect(bytes).toEqual(Buffer.from('png'))
    expect(request).toHaveBeenLastCalledWith(new URL('https://public.example/image.png'), '93.184.216.34', expect.any(AbortSignal))
  })

  it('revalidates redirects, rejects loops, and caps redirect depth', async () => {
    const request = vi.fn(async (url: URL) => {
      if (url.hostname === 'public.example') return response(302, { location: 'http://127.0.0.1/secret' })
      return response(200, { 'content-type': 'image/png' }, [Buffer.from('x')])
    })
    await expect(fetchRemoteImage('https://public.example/image', {
      resolve: async (host) => host === 'public.example' ? ['93.184.216.34'] : ['127.0.0.1'],
      request,
    })).rejects.toMatchObject({ code: 'REMOTE_IMAGE_TARGET_BLOCKED' })

    const loopRequest = vi.fn(async () => response(302, { location: '/image' }))
    await expect(fetchRemoteImage('https://public.example/image', {
      resolve: async () => ['93.184.216.34'],
      request: loopRequest,
    })).rejects.toMatchObject({ code: 'REMOTE_IMAGE_REDIRECT_LOOP' })
  })

  it('requires image content and enforces declared and streamed size bounds', async () => {
    const deps = { resolve: async () => ['93.184.216.34'] }
    await expect(fetchRemoteImage('https://public.example/not-image', {
      ...deps,
      request: async () => response(200, { 'content-type': 'text/html' }, [Buffer.from('<html>')]),
    })).rejects.toMatchObject({ code: 'REMOTE_IMAGE_CONTENT_TYPE' })

    await expect(fetchRemoteImage('https://public.example/large', {
      ...deps,
      maxBytes: 4,
      request: async () => response(200, { 'content-type': 'image/png', 'content-length': '5' }, [Buffer.alloc(5)]),
    })).rejects.toMatchObject({ code: 'REMOTE_IMAGE_TOO_LARGE' })

    await expect(fetchRemoteImage('https://public.example/chunked', {
      ...deps,
      maxBytes: 4,
      request: async () => response(200, { 'content-type': 'image/png' }, [Buffer.alloc(3), Buffer.alloc(2)]),
    })).rejects.toMatchObject({ code: 'REMOTE_IMAGE_TOO_LARGE' })
  })
})
