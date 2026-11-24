import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({ uploadCdnAsset: vi.fn(async (_b: Buffer, mime: string) => ({ key: 'k', url: `https://cdn.test/x.${mime.split('/')[1]}` })) }))
// Avoid real DNS: public hosts resolve to a public IP, our sentinel 'blocked.test' to a private one.
const { lookup, fetchMock } = vi.hoisted(() => ({
  lookup: vi.fn(async (host: string) => host === 'blocked.test' ? [{ address: '10.0.0.5', family: 4 }] : host === 'unknown.test' ? [] : [{ address: '93.184.216.34', family: 4 }]),
  fetchMock: vi.fn(),
}))
vi.mock('node:dns/promises', () => ({ lookup }))
// node:http(s) stand-in: runs the request's lookup as Node does at connect time, then answers with fetchMock(url, addrs).
vi.mock('node:https', async () => ({ default: await fakeModule() }))
vi.mock('node:http', async () => ({ default: await fakeModule() }))
async function fakeModule() {
  const { EventEmitter } = await import('node:events')
  return { request: (url: URL, opts: any, cb: (r: any) => void) => {
    const req: any = new EventEmitter()
    req.end = () => opts.lookup(url.hostname, { all: true }, (err: Error | null, addrs: any[]) => {
      if (err) return req.emit('error', err)
      Promise.resolve().then(() => fetchMock(url, addrs)).then(cb, (e: Error) => req.emit('error', e))
    })
    return req
  } }
}

import { Readable } from 'node:stream'
import { fetchMedia, hostUrl, MediaError } from '../src/media'

const res = (o: { status?: number; headers?: Record<string, string>; body?: Buffer }) => {
  const r: any = Readable.from([o.body ?? Buffer.from('x')])
  r.statusCode = o.status ?? 200
  r.headers = o.headers ?? {}
  return r
}

describe('fetchMedia (network mocked)', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('downloads a public URL and returns its bytes + declared type', async () => {
    fetchMock.mockResolvedValue(res({ headers: { 'content-type': 'image/png; charset=binary' }, body: Buffer.from('PNGDATA') }))
    const out = await fetchMedia('https://example.test/a.png')
    expect(out.type).toBe('image/png')
    expect(out.bytes.toString()).toBe('PNGDATA')
  })

  it('follows a redirect, re-checking the new URL is public', async () => {
    fetchMock
      .mockResolvedValueOnce(res({ status: 302, headers: { location: 'https://example.test/final.jpg' } }))
      .mockResolvedValueOnce(res({ headers: { 'content-type': 'image/jpeg' }, body: Buffer.from('J') }))
    const out = await fetchMedia('https://example.test/a')
    expect(out.type).toBe('image/jpeg')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses a host that resolves public for the pre-check but private at connect time, without connecting', async () => {
    lookup.mockClear()
    lookup.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]).mockResolvedValueOnce([{ address: '192.168.1.9', family: 4 }])
    await expect(fetchMedia('https://rebind.test/a.png')).rejects.toMatchObject({ code: 'invalid_media_url', status: 422, message: 'media_url points at a private address' })
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('connects to the vetted address list for a public host', async () => {
    fetchMock.mockResolvedValue(res({ headers: { 'content-type': 'image/png' } }))
    await fetchMedia('https://example.test/a.png')
    expect(fetchMock.mock.calls[0][1]).toEqual([{ address: '93.184.216.34', family: 4 }])
  })

  it('refuses private IP literals (v4 and v6) without connecting', async () => {
    for (const u of ['http://10.1.2.3/a', 'https://127.0.0.1/a', 'https://169.254.169.254/a', 'https://[::1]/a', 'https://[fd00::1]/a']) {
      await expect(fetchMedia(u)).rejects.toMatchObject({ code: 'invalid_media_url' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a redirect to a private address', async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 302, headers: { location: 'http://blocked.test/secret' } }))
    await expect(fetchMedia('https://example.test/a')).rejects.toMatchObject({ code: 'invalid_media_url' })
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(res({ status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }))
    await expect(fetchMedia('https://example.test/a')).rejects.toMatchObject({ code: 'invalid_media_url' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('enforces the size cap while streaming, without a content-length', async () => {
    fetchMock.mockResolvedValue(res({ body: Buffer.alloc(15 * 1024 * 1024 + 1) }))
    await expect(fetchMedia('https://example.test/big.png')).rejects.toMatchObject({ code: 'media_too_large', status: 413 })
  })

  it('rejects a private resolution, an unresolvable host, and too many redirects', async () => {
    await expect(fetchMedia('https://blocked.test/a.png')).rejects.toMatchObject({ code: 'invalid_media_url' })
    await expect(fetchMedia('https://unknown.test/a.png')).rejects.toMatchObject({ code: 'invalid_media_url' })
    fetchMock.mockImplementation(async () => res({ status: 301, headers: { location: 'https://example.test/next' } }))
    await expect(fetchMedia('https://example.test/loop')).rejects.toMatchObject({ code: 'media_unreachable' })
  })

  it('refuses a non-200 / body-less response and an oversize content-length', async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 500 }))
    await expect(fetchMedia('https://example.test/a.png')).rejects.toMatchObject({ code: 'media_unreachable' })
    fetchMock.mockResolvedValueOnce(res({ headers: { 'content-length': String(20 * 1024 * 1024) }, body: Buffer.from('x') }))
    await expect(fetchMedia('https://example.test/big.png')).rejects.toMatchObject({ code: 'media_too_large', status: 413 })
  })

  it('surfaces a fetch/transport error as media_unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(fetchMedia('https://example.test/a.png')).rejects.toMatchObject({ code: 'media_unreachable' })
  })

  it('a non-standard port is rejected', async () => {
    await expect(fetchMedia('https://example.test:8443/a.png')).rejects.toMatchObject({ code: 'invalid_media_url' })
  })
})

describe('hostUrl caching', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('fetches + hosts once, then serves the cached URL for the same source', async () => {
    const sharp = (await import('sharp')).default
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer()
    fetchMock.mockResolvedValue(res({ headers: { 'content-type': 'image/jpeg' }, body: jpeg }))
    const first = await hostUrl('https://example.test/pic.jpg', 'https://cdn.test/')
    expect(first.fresh).toBe(true)
    const second = await hostUrl('https://example.test/pic.jpg', 'https://cdn.test/')
    expect(second.fresh).toBe(false)
    expect(second.url).toBe(first.url)
    expect(fetchMock).toHaveBeenCalledTimes(1) // second served from cache
  })
})
