import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted so cookies() mock is available when the route module imports next/headers
const mockCookieStore = vi.hoisted(() => ({
  get: vi.fn().mockReturnValue(undefined),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieStore),
}))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  verifyToken: vi.fn(),
}))

import { POST } from '@/app/api/track/route'
import * as db from '@/lib/db'
import * as jwtLib from '@/lib/jwt'

function makePost(body: object, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = { sessionId: 'sess-1', page: 'Home', path: '/' }

beforeEach(() => {
  vi.clearAllMocks()
  mockCookieStore.get.mockReturnValue(undefined)
})

describe('POST /api/track', () => {
  it('returns 400 when sessionId is missing', async () => {
    const res = await POST(makePost({ page: 'Home', path: '/' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 when page is missing', async () => {
    const res = await POST(makePost({ sessionId: 'sess-1', path: '/' }) as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when path is missing', async () => {
    const res = await POST(makePost({ sessionId: 'sess-1', page: 'Home' }) as any)
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
      expect.arrayContaining(['sess-1', null, 'Home', '/'])
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

  it('returns 500 when db insert throws', async () => {
    vi.mocked(db.query).mockRejectedValue(new Error('db error'))

    const res = await POST(makePost(VALID_BODY) as any)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })
})
