import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted so cookies() mock is available when the route module imports next/headers
const mockCookieStore = vi.hoisted(() => ({
  get: vi.fn().mockReturnValue(undefined),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}))
vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
}))
vi.mock('@/lib/auth/jwt', () => ({
  verifyToken: vi.fn(),
}))

import { POST } from '@/app/api/(public)/track/route'
import * as db from '@/lib/shared/db'
import * as jwtLib from '@/lib/auth/jwt'

function makePost(body: object, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = { sessionId: 'sess-1', page: 'home', path: '/' }

beforeEach(() => {
  vi.clearAllMocks()
  mockCookieStore.get.mockReturnValue(undefined)
})

describe('POST /api/track', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await POST(makePost({ page: 'home', path: '/' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 when page is missing', async () => {
    const res = await POST(makePost({ sessionId: 'sess-1', path: '/' }) as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when path is missing', async () => {
    const res = await POST(makePost({ sessionId: 'sess-1', page: 'home' }) as any)
    expect(res.status).toBe(400)
  })

  it('inserts page event without auth token and returns ok', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost(VALID_BODY, { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'TestBot/1' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO page_events'),
      expect.arrayContaining(['sess-1', null, 'home', '/'])
    )
  })

  it('resolves userId from user_sid cookie when present', async () => {
    mockCookieStore.get.mockReturnValue({ value: 'valid-token' })
    vi.mocked(jwtLib.verifyToken).mockResolvedValue({ userId: 'user-99' } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await POST(makePost(VALID_BODY) as any)
    expect(res.status).toBe(200)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO page_events'),
      expect.arrayContaining(['sess-1', 'user-99'])
    )
  })

  it('includes referrer when provided', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    await POST(makePost({ ...VALID_BODY, referrer: 'https://google.com' }) as any)
    expect(db.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining(['https://google.com']))
  })

  it('stores the session attribution, trimmed, null when absent', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    await POST(
      makePost({
        ...VALID_BODY,
        attribution: { utm_source: ' google ', utm_medium: 'cpc', utm_campaign: 'diwali', gclid: 'G1', wbraid: 7 },
      }) as any
    )
    const params = vi.mocked(db.query).mock.calls[0][1] as unknown[]
    expect(params.slice(7)).toEqual(['google', 'cpc', 'diwali', 'G1', null, null])

    await POST(makePost(VALID_BODY) as any)
    expect((vi.mocked(db.query).mock.calls[1][1] as unknown[]).slice(7)).toEqual([null, null, null, null, null, null])
  })

  it('returns 500 when db insert throws', async () => {
    vi.mocked(db.query).mockRejectedValue(new Error('db error'))

    const res = await POST(makePost(VALID_BODY) as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
  it('rejects a URL sent as the page type with 400 instead of a db error', async () => {
    const res = await POST(
      makePost({ sessionId: 'sess-1', page: '/products/unbrako-hex-bolt-metric-10-9-m20', path: '/products/x' }) as any
    )
    expect(res.status).toBe(400)
  })
})
