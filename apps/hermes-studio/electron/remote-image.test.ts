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
  it('classifies loopback, private, link-local, mapped, and documentation addresses as non-public', () => {
    for (const address of [
      '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1',
      '100.64.0.1', '192.0.2.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1',
    ]) {
      expect(isPublicIpAddress(address), address).toBe(false)
    }
    expect(isPublicIpAddress('93.184.216.34')).toBe(true)
    expect(isPublicIpAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(true)
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
