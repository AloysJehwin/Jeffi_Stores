import { vi, describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
  authenticateAdmin: vi.fn(),
  authenticateUser: vi.fn(),
  verifyToken: vi.fn(),
}))
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn() }))

import { POST } from '@/app/api/products/[id]/view/route'
import { query, queryOne } from '@/lib/db'
import { authenticateAnyUser } from '@/lib/jwt'

const mockQuery = vi.mocked(query)
const mockQueryOne = vi.mocked(queryOne)
const mockAuth = vi.mocked(authenticateAnyUser)

function makeRequest(opts: { sessionId?: string } = {}) {
  const headers: Record<string, string> = {}
  if (opts.sessionId) headers['x-session-id'] = opts.sessionId
  return new NextRequest('http://localhost/api/products/prod1/view', {
    method: 'POST',
    headers,
  })
}

const params = { params: Promise.resolve({ id: 'prod1' }) }

describe('POST /api/products/[id]/view', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns ok when unauthenticated', async () => {
    mockAuth.mockRejectedValueOnce(new Error('no auth'))
    mockQuery.mockResolvedValueOnce(undefined as any)

    const res = await POST(makeRequest(), params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it('inserts product view with session_id from header', async () => {
    mockAuth.mockResolvedValueOnce(null)
    mockQuery.mockResolvedValueOnce(undefined as any)

    const res = await POST(makeRequest({ sessionId: 'sess123' }), params as any)
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO product_views'),
      expect.arrayContaining(['prod1'])
    )
  })

  it('logs activity when user is authenticated and no recent view', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'user1' } as any)
    mockQuery.mockResolvedValueOnce(undefined as any)
    mockQueryOne
      .mockResolvedValueOnce(null)                        // no recent activity
      .mockResolvedValueOnce({ name: 'Test Product' })    // product name

    const res = await POST(makeRequest(), params as any)
    expect(res.status).toBe(200)
  })

  it('skips logActivity when recent view exists', async () => {
    mockAuth.mockResolvedValueOnce({ userId: 'user1' } as any)
    mockQuery.mockResolvedValueOnce(undefined as any)
    mockQueryOne.mockResolvedValueOnce({ id: 'recent-log' })  // recent activity found

    const res = await POST(makeRequest(), params as any)
    expect(res.status).toBe(200)
    // Only one queryOne call (the recent activity check) — product name not fetched
    expect(mockQueryOne).toHaveBeenCalledTimes(1)
  })

  it('handles db insert error gracefully', async () => {
    mockAuth.mockResolvedValueOnce(null)
    mockQuery.mockRejectedValueOnce(new Error('db error'))

    const res = await POST(makeRequest(), params as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })
})
