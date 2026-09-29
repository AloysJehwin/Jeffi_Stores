import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/customer-conversations-ai', () => ({
  getAiSummary: vi.fn(),
  refreshAiSummary: vi.fn(),
  aiProfileConfigured: vi.fn(),
}))

import { GET, POST } from '@/app/api/admin/customers/[id]/ai-summary/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getAiSummary, refreshAiSummary, aiProfileConfigured } from '@/lib/customer-conversations-ai'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGet = vi.mocked(getAiSummary)
const mockRefresh = vi.mocked(refreshAiSummary)
const mockConfigured = vi.mocked(aiProfileConfigured)

const adminPayload = { adminId: 'admin-1', username: 'a', role: 'super_admin', scopes: ['customers'] }

function makeRequest(method: 'GET' | 'POST', id = 'user-1') {
  return new NextRequest(`http://localhost/api/admin/customers/${id}/ai-summary`, {
    method, headers: { cookie: 'admin_sid=valid' },
  })
}

const ctx = (id = 'user-1') => ({ params: Promise.resolve({ id }) })

describe('GET /api/admin/customers/[id]/ai-summary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the cached summary row', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockGet.mockResolvedValue({ summary: 'Loyal buyer.', generatedAt: '2024-01-01T00:00:00.000Z' })

    const res = await GET(makeRequest('GET'), ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ summary: 'Loyal buyer.', generatedAt: '2024-01-01T00:00:00.000Z' })
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest('GET'), ctx())
    expect(res.status).toBe(401)
  })
})

describe('POST /api/admin/customers/[id]/ai-summary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 403 without the write scope', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await POST(makeRequest('POST'), ctx())
    expect(res.status).toBe(403)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('returns 503 when AI is not configured', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockConfigured.mockReturnValue(false)
    const res = await POST(makeRequest('POST'), ctx())
    expect(res.status).toBe(503)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('calls refreshAiSummary and returns the result when configured', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockConfigured.mockReturnValue(true)
    mockRefresh.mockResolvedValue({ summary: 'Fresh profile.', generatedAt: '2024-02-02T00:00:00.000Z' })

    const res = await POST(makeRequest('POST', 'user-9'), ctx('user-9'))
    expect(res.status).toBe(200)
    expect(mockRefresh).toHaveBeenCalledWith('user-9')
    const body = await res.json()
    expect(body).toEqual({ summary: 'Fresh profile.', generatedAt: '2024-02-02T00:00:00.000Z' })
  })

  it('returns 503 when refreshAiSummary throws', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    mockConfigured.mockReturnValue(true)
    mockRefresh.mockRejectedValue(new Error('provider down'))

    const res = await POST(makeRequest('POST'), ctx())
    expect(res.status).toBe(503)
  })
})
