import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))

import { GET, POST, DELETE } from '@/app/api/user/search-history/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'

const AUTH_USER = { userId: 'user-1' }

function makeGet() {
  return new Request('http://localhost/api/user/search-history')
}
function makePost(body: object) {
  return new Request('http://localhost/api/user/search-history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function makeDelete() {
  return new Request('http://localhost/api/user/search-history', { method: 'DELETE' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── GET ───────────────────────────────────────────────────────────────────────

describe('GET /api/user/search-history', () => {
  it('returns empty history when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.history).toEqual([])
  })

  it('returns history for authenticated user', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryMany).mockResolvedValue([{ query: 'shoes' }, { query: 'bags' }] as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.history).toEqual(['shoes', 'bags'])
  })
})

// ── POST ──────────────────────────────────────────────────────────────────────

describe('POST /api/user/search-history', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await POST(makePost({ query: 'shoes' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when query is empty', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    const res = await POST(makePost({ query: '   ' }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
  })

  it('returns 400 when query is missing', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)

    const res = await POST(makePost({}) as any)
    expect(res.status).toBe(400)
  })

  it('inserts search term and returns ok', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue(null as any)

    const res = await POST(makePost({ query: 'running shoes' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // delete duplicate, insert, then prune old — 3 queryOne calls
    expect(db.queryOne).toHaveBeenCalledTimes(3)
  })

  it('truncates query to 200 chars', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue(null as any)
    const longQuery = 'a'.repeat(300)

    const res = await POST(makePost({ query: longQuery }) as any)
    expect(res.status).toBe(200)
    const insertCall = vi.mocked(db.queryOne).mock.calls[1]
    expect(insertCall[1][1].length).toBe(200)
  })
})

// ── DELETE ────────────────────────────────────────────────────────────────────

describe('DELETE /api/user/search-history', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await DELETE(makeDelete() as any)
    expect(res.status).toBe(401)
  })

  it('clears all history and returns ok', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)

    const res = await DELETE(makeDelete() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM user_search_history'),
      expect.arrayContaining(['user-1'])
    )
  })
})
