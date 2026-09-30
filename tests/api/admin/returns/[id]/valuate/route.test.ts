import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/shared/activity', () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }))

import { POST } from '@/app/api/(admin)/admin/returns/[id]/valuate/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, withTransaction } from '@/lib/shared/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['orders'] }
const params = Promise.resolve({ id: 'rr-1' })
const RETURN = { id: 'rr-1', order_id: 'ord-1', order_number: '1001', user_id: 'u1', valuation_status: null }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryOne).mockResolvedValue(RETURN as any)
  vi.mocked(withTransaction).mockImplementation(async (fn: any) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [] }) })
  )
})

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/returns/rr-1/valuate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/returns/[id]/valuate', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makeReq({ condition: 'good' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makeReq({ condition: 'good' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 for invalid condition', async () => {
    const res = await POST(makeReq({ condition: 'unknown' }), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Invalid condition/)
  })

  it('returns 404 when return request not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(makeReq({ condition: 'good' }), { params })
    expect(res.status).toBe(404)
  })

  it('returns 409 when valuation already completed', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ...RETURN, valuation_status: 'approved' } as any)
    const res = await POST(makeReq({ condition: 'good' }), { params })
    expect(res.status).toBe(409)
  })

  it('saves valuation and returns success', async () => {
    const res = await POST(makeReq({ condition: 'defective', notes: 'Minor scratch', restock: true }), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.condition).toBe('defective')
  })

  it('handles no restock flag', async () => {
    const res = await POST(makeReq({ condition: 'damaged', restock: false }), { params })
    expect(res.status).toBe(200)
  })

  it('returns 500 on db error', async () => {
    vi.mocked(withTransaction).mockRejectedValue(new Error('fail'))
    const res = await POST(makeReq({ condition: 'good' }), { params })
    expect(res.status).toBe(500)
  })
})
