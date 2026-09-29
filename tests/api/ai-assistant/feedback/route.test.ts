import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/jwt', () => ({
  authenticateUser: vi.fn(),
  authenticateAdmin: vi.fn(),
  authenticateAnyUser: vi.fn(),
  verifyToken: vi.fn(),
}))

import { POST } from '@/app/api/ai-assistant/feedback/route'
import { authenticateUser } from '@/lib/jwt'
import { queryOne, query } from '@/lib/db'

const mockAuth = vi.mocked(authenticateUser)
const mockQueryOne = vi.mocked(queryOne)
const mockQuery = vi.mocked(query)

const USER_ID = 'user-1234-5678-abcd-ef1234567890'
const AI_QUERY_ID = 'aqid-1234-5678-abcd-ef1234567890'

function makeRequest(body: object) {
  return new Request('http://localhost/api/ai-assistant/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/ai-assistant/feedback', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ aiQueryId: AI_QUERY_ID, signal: 'helpful' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 for invalid signal', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const res = await POST(makeRequest({ aiQueryId: AI_QUERY_ID, signal: 'invalid_signal' }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid signal')
  })

  it('returns 400 when aiQueryId is missing', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const res = await POST(makeRequest({ signal: 'helpful' }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('aiQueryId is required')
  })

  it('returns 404 when ai_query not found or not owned', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ aiQueryId: AI_QUERY_ID, signal: 'helpful' }) as any)
    expect(res.status).toBe(404)
  })

  it('inserts feedback and returns ok for all valid signals', async () => {
    const validSignals = ['helpful', 'not_helpful', 'overall_helpful', 'overall_not_helpful', 'clicked', 'added_to_cart', 'purchased']
    for (const signal of validSignals) {
      vi.clearAllMocks()
      mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
      mockQueryOne.mockResolvedValueOnce({ id: AI_QUERY_ID })
      mockQuery.mockResolvedValueOnce(undefined as any)

      const res = await POST(makeRequest({ aiQueryId: AI_QUERY_ID, signal }) as any)
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.ok).toBe(true)
    }
  })

  it('includes productId in insert when provided', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne.mockResolvedValueOnce({ id: AI_QUERY_ID })
    mockQuery.mockResolvedValueOnce(undefined as any)

    await POST(makeRequest({ aiQueryId: AI_QUERY_ID, signal: 'clicked', productId: 'prod-123' }) as any)

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_feedback'),
      expect.arrayContaining(['prod-123'])
    )
  })

  it('passes null productId when not provided', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne.mockResolvedValueOnce({ id: AI_QUERY_ID })
    mockQuery.mockResolvedValueOnce(undefined as any)

    await POST(makeRequest({ aiQueryId: AI_QUERY_ID, signal: 'helpful' }) as any)

    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([null]) // productId is null
    )
  })

  it('truncates comment to 500 chars', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockQueryOne.mockResolvedValueOnce({ id: AI_QUERY_ID })
    mockQuery.mockResolvedValueOnce(undefined as any)

    const longComment = 'x'.repeat(600)
    await POST(makeRequest({ aiQueryId: AI_QUERY_ID, signal: 'helpful', comment: longComment }) as any)

    const insertArgs = mockQuery.mock.calls[0][1] as any[]
    const storedComment = insertArgs.find((a: any) => typeof a === 'string' && a.length === 500)
    expect(storedComment).toBeDefined()
  })

  it('handles invalid JSON body gracefully', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const req = new Request('http://localhost/api/ai-assistant/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req as any)
    // Should return 400 (missing aiQueryId) not 500
    expect(res.status).toBe(400)
  })
})
