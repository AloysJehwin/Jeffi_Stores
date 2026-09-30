import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))

import { GET } from '@/app/api/(public)/email-events/click/route'
import { query } from '@/lib/shared/db'

const mockQuery = vi.mocked(query)

function makeRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/email-events/click')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  // Provide nextUrl by extending the Request
  const req = new Request(url.toString())
  // Vitest happy-dom provides URL from request, but Next uses nextUrl
  Object.defineProperty(req, 'nextUrl', { value: url, writable: false })
  return req
}

describe('GET /api/email-events/click', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.APP_URL = 'http://localhost:3000'
  })

  it('redirects to the provided url param (302)', async () => {
    const res = await GET(makeRequest({ url: 'https://jeffistores.com/products/bolt' }) as any)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://jeffistores.com/products/bolt')
  })

  it('updates DB when id is provided', async () => {
    mockQuery.mockResolvedValueOnce(undefined as any)
    await GET(makeRequest({ id: 'sent-123', url: 'https://jeffistores.com' }) as any)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('clicked_at'), ['sent-123'])
  })

  it('does not call DB when id is absent', async () => {
    await GET(makeRequest({ url: 'https://jeffistores.com' }) as any)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('falls back to APP_URL when no url param', async () => {
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(302)
    // NextResponse.redirect may normalise the URL (add trailing slash for bare origin)
    expect(res.headers.get('location')).toMatch(/^http:\/\/localhost:3000\/?$/)
  })

  it('falls back to APP_URL when url param is not http(s)', async () => {
    const res = await GET(makeRequest({ url: '/relative/path' }) as any)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toMatch(/^http:\/\/localhost:3000\/?$/)
  })

  it('ignores DB errors (fire-and-forget)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db error'))
    // Should not throw — error is caught with .catch(() => {})
    const res = await GET(makeRequest({ id: 'bad-id', url: 'https://jeffistores.com' }) as any)
    expect(res.status).toBe(302)
  })
})
