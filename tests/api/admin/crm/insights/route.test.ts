import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/crm-insights', () => ({
  getCrmInsights: vi.fn(),
}))

import { GET } from '@/app/api/admin/crm/insights/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getCrmInsights } from '@/lib/crm-insights'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockInsights = vi.mocked(getCrmInsights)

const adminPayload = { adminId: 'admin-1', username: 'testadmin', role: 'super_admin', scopes: ['crm'] }

function makeRequest(searchParams: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/crm/insights')
  for (const [k, v] of Object.entries(searchParams)) url.searchParams.set(k, v)
  return new NextRequest(url.toString(), { method: 'GET', headers: { cookie: 'admin_sid=valid' } })
}

describe('GET /api/admin/crm/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsights.mockResolvedValue({ range: '30d', segment: 'all' } as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope is insufficient', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
  })

  it('returns 200 with insights JSON', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeRequest({ range: '90d', segment: 'vip' }))
    expect(res.status).toBe(200)
    expect(mockInsights).toHaveBeenCalledWith({ range: '90d', segment: 'vip' })
  })

  it('falls back to defaults on invalid params', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    const res = await GET(makeRequest({ range: 'decade', segment: 'bogus' }))
    expect(res.status).toBe(200)
    expect(mockInsights).toHaveBeenCalledWith({ range: '30d', segment: 'all' })
  })

  it('defaults when params are absent', async () => {
    mockAuth.mockResolvedValue(adminPayload)
    mockHasScope.mockReturnValue(true)
    await GET(makeRequest())
    expect(mockInsights).toHaveBeenCalledWith({ range: '30d', segment: 'all' })
  })
})
