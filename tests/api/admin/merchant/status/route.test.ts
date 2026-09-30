import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))

vi.mock('@/lib/scopes', () => ({
  hasScope: vi.fn(),
}))

vi.mock('@/lib/merchant/sync', () => ({
  getLastSyncStatus: vi.fn(),
  syncAllProductsToMerchant: vi.fn(),
  syncProductToMerchant: vi.fn(),
  sendSyncFailureEmail: vi.fn(),
}))

import { GET } from '@/app/api/admin/merchant/status/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { getLastSyncStatus } from '@/lib/merchant/sync'

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockGetStatus = vi.mocked(getLastSyncStatus)

const admin = { adminId: 'a1', username: 'admin', role: 'super_admin', scopes: ['products'] }

function makeReq() {
  return new NextRequest('http://localhost/api/admin/merchant/status')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/merchant/status', () => {
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

  it('returns status on happy path', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    const status = { synced: 100, last_sync: '2024-01-01T00:00:00Z' }
    mockGetStatus.mockResolvedValue(status as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toEqual(status)
  })

  it('returns status: null when getLastSyncStatus returns undefined', async () => {
    mockAuth.mockResolvedValue(admin)
    mockHasScope.mockReturnValue(true)
    mockGetStatus.mockResolvedValue(undefined as any)
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBeNull()
  })
})
