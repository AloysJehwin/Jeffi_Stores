import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { GET } from '@/app/api/email-events/open/route'
import { query } from '@/lib/db'

const mockQuery = vi.mocked(query)

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/email-events/open')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const req = new Request(url.toString())
  Object.defineProperty(req, 'nextUrl', { value: url, writable: false })
  return req
}

describe('GET /api/email-events/open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with image/gif content-type', async () => {
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/gif')
  })

  it('returns a non-empty body (pixel GIF)', async () => {
    const res = await GET(makeRequest() as any)
    const buf = await res.arrayBuffer()
    expect(buf.byteLength).toBeGreaterThan(0)
  })

  it('sets no-cache headers', async () => {
    const res = await GET(makeRequest() as any)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('pragma')).toBe('no-cache')
  })

  it('updates DB opened_at when id is provided', async () => {
    mockQuery.mockResolvedValueOnce(undefined as any)
    await GET(makeRequest({ id: 'sent-456' }) as any)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('opened_at'), ['sent-456'])
  })

  it('does not call DB when id is absent', async () => {
    await GET(makeRequest() as any)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('still returns pixel even when DB errors (fire-and-forget)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db fail'))
    const res = await GET(makeRequest({ id: 'bad-id' }) as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/gif')
  })

  it('content-length header matches actual body size', async () => {
    const res = await GET(makeRequest() as any)
    const buf = await res.arrayBuffer()
    // Content-Length should match the buffer size
    const contentLength = res.headers.get('content-length')
    expect(contentLength).toBe(String(buf.byteLength))
  })
})
