import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/admin-crm', () => ({
  getCrmDashboardData: vi.fn(),
}))

import { GET } from '@/app/api/admin/crm/dashboard/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getCrmDashboardData } from '@/lib/admin-crm'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGetCrm = vi.mocked(getCrmDashboardData)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['customers'] }

function makeReq() {
  return new NextRequest('http://localhost/api/admin/crm/dashboard')
}

beforeEach(() => { vi.clearAllMocks() })

describe('GET /api/admin/crm/dashboard', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await GET(makeReq())
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(false)
    const res = await GET(makeReq())
    expect(res.status).toBe(403)
  })

  it('returns dashboard data on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const data = { totalCustomers: 50, newThisMonth: 5 }
    mockGetCrm.mockResolvedValue(data as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual(data)
    expect(mockGetCrm).toHaveBeenCalledWith('a1')
  })
})
