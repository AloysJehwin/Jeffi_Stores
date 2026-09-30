import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockAuth = vi.fn()
const mockHasScope = vi.fn()
const mockGetPL = vi.fn()

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: mockAuth }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: mockHasScope }))
vi.mock('@/lib/payments/financial', () => ({ getPLReport: mockGetPL }))

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: [] }

function makeReq(search = '') {
  return new NextRequest('http://localhost/api/admin/financial/pl' + search)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(ADMIN)
  mockHasScope.mockReturnValue(true)
  mockGetPL.mockResolvedValue({ revenue: 100, expenses: 50 })
})

describe('GET /api/admin/financial/pl', () => {
  it('returns 401 when unauthenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const { GET } = await import('@/app/api/admin/financial/pl/route')
    expect((await GET(makeReq())).status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const { GET } = await import('@/app/api/admin/financial/pl/route')
    expect((await GET(makeReq())).status).toBe(403)
  })

  it('returns 200 with default FY dates', async () => {
    const { GET } = await import('@/app/api/admin/financial/pl/route')
    expect((await GET(makeReq())).status).toBe(200)
  })

  it('uses from/to query params when provided', async () => {
    const { GET } = await import('@/app/api/admin/financial/pl/route')
    expect((await GET(makeReq('?from=2026-01-01&to=2026-03-31'))).status).toBe(200)
  })

  it('returns 500 on getPLReport error', async () => {
    mockGetPL.mockRejectedValue(new Error('db fail'))
    const { GET } = await import('@/app/api/admin/financial/pl/route')
    expect((await GET(makeReq())).status).toBe(500)
  })
})
