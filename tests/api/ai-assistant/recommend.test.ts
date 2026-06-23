import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateUser: vi.fn(),
  authenticateAdmin: vi.fn(),
  authenticateAnyUser: vi.fn(),
  verifyToken: vi.fn(),
}))
vi.mock('@/lib/ai-assistant', () => ({
  recommendProducts: vi.fn(),
  getRemainingQuota: vi.fn(),
}))
vi.mock('@/lib/validate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/validate')>()
  return { ...actual }
})

import { GET, POST } from '@/app/api/ai-assistant/recommend/route'
import { authenticateUser } from '@/lib/jwt'
import { recommendProducts, getRemainingQuota } from '@/lib/ai-assistant'

const mockAuth = vi.mocked(authenticateUser)
const mockRecommend = vi.mocked(recommendProducts)
const mockGetQuota = vi.mocked(getRemainingQuota)

const USER_ID = 'user-uuid-1234-5678'

function makeGetRequest() {
  return new Request('http://localhost/api/ai-assistant/recommend')
}

function makePostRequest(body: object) {
  return new Request('http://localhost/api/ai-assistant/recommend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/ai-assistant/recommend', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await GET(makeGetRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns quota for authenticated user', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockGetQuota.mockResolvedValueOnce({ used: 0, remaining: 8, resetAt: new Date() } as any)
    const res = await GET(makeGetRequest() as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.quota.remaining).toBe(8)
  })
})

describe('POST /api/ai-assistant/recommend', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValueOnce(null)
    const res = await POST(makePostRequest({ query: 'I need bolts for my project' }) as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when query is too short (< 5 chars)', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const res = await POST(makePostRequest({ query: 'hi' }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('at least a few words')
  })

  it('returns 400 when query exceeds 500 chars', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const res = await POST(makePostRequest({ query: 'x'.repeat(501) }) as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('500 characters')
  })

  it('returns recommendations and quota on success', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockRecommend.mockResolvedValueOnce({
      products: [{ id: 'p1', name: 'Hex Bolt' }],
      message: 'Here are some bolts',
    } as any)
    mockGetQuota.mockResolvedValueOnce({ used: 0, remaining: 7, resetAt: new Date() } as any)

    const res = await POST(makePostRequest({ query: 'I need hex bolts for my machine' }) as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.products).toHaveLength(1)
    expect(json.quota.remaining).toBe(7)
  })

  it('returns 429 when daily limit exceeded', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockRecommend.mockRejectedValueOnce(new Error('Daily limit reached'))

    const res = await POST(makePostRequest({ query: 'Need some fasteners' }) as any)
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.error).toContain('Daily limit')
  })

  it('returns 500 on other AI errors', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    mockRecommend.mockRejectedValueOnce(new Error('Model timeout'))

    const res = await POST(makePostRequest({ query: 'What bolts do I need' }) as any)
    expect(res.status).toBe(500)
  })

  it('handles invalid JSON body (empty object fallback)', async () => {
    mockAuth.mockResolvedValueOnce({ userId: USER_ID } as any)
    const req = new Request('http://localhost/api/ai-assistant/recommend', {
      method: 'POST',
      body: 'not-json',
    })
    const res = await POST(req as any)
    // query will be '' (empty), which is < 5 chars
    expect(res.status).toBe(400)
  })
})
