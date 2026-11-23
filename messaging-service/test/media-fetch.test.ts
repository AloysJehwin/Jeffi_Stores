import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({ uploadCdnAsset: vi.fn(async (_b: Buffer, mime: string) => ({ key: 'k', url: `https://cdn.test/x.${mime.split('/')[1]}` })) }))
// Avoid real DNS: public hosts resolve to a public IP, our sentinel 'blocked.test' to a private one.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(async (host: string) => host === 'blocked.test' ? [{ address: '10.0.0.5' }] : host === 'unknown.test' ? [] : [{ address: '93.184.216.34' }]) }))

import { fetchMedia, hostUrl, MediaError } from '../src/media'

const stream = (buf: Buffer) => ({ async *[Symbol.asyncIterator]() { yield new Uint8Array(buf) } })
const res = (o: { status?: number; headers?: Record<string, string>; body?: Buffer | null }) => ({
  status: o.status ?? 200, ok: (o.status ?? 200) < 300,
  headers: { get: (k: string) => (o.headers ?? {})[k.toLowerCase()] ?? null },
  body: o.body === null ? null : stream(o.body ?? Buffer.from('x')),
})

describe('fetchMedia (network mocked)', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

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

  it('rejects a private resolution, an unresolvable host, and too many redirects', async () => {
    await expect(fetchMedia('https://blocked.test/a.png')).rejects.toMatchObject({ code: 'invalid_media_url' })
    await expect(fetchMedia('https://unknown.test/a.png')).rejects.toMatchObject({ code: 'invalid_media_url' })
    fetchMock.mockResolvedValue(res({ status: 301, headers: { location: 'https://example.test/next' } }))
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
  const fetchMock = vi.fn()
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
  afterEach(() => vi.unstubAllGlobals())

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
