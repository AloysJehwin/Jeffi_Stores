import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }))

import { POST, DELETE } from '@/app/api/admin/coupons/[id]/eligible-users/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['coupons'] }
const params = Promise.resolve({ id: 'coupon-1' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryOne).mockResolvedValue({ id: 'coupon-1' } as any)
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
})

function makeReq(body: unknown) {
  return new NextRequest('http://localhost/api/admin/coupons/coupon-1/eligible-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/admin/coupons/[id]/eligible-users', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makeReq({ user_id: 'u1' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makeReq({ user_id: 'u1' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 when user_id missing', async () => {
    const res = await POST(makeReq({}), { params })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/user_id/)
  })

  it('returns 404 when coupon not found', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    const res = await POST(makeReq({ user_id: 'u1' }), { params })
    expect(res.status).toBe(404)
  })

  it('adds user to eligible list', async () => {
    const res = await POST(makeReq({ user_id: 'u1' }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('coupon_eligible_users'),
      ['coupon-1', 'u1'],
    )
  })

  it('returns 500 on db error', async () => {
    vi.mocked(query).mockRejectedValue(new Error('fail'))
    const res = await POST(makeReq({ user_id: 'u1' }), { params })
    expect(res.status).toBe(500)
  })
})

describe('DELETE /api/admin/coupons/[id]/eligible-users', () => {
  function makeDeleteReq(body: unknown) {
    return new NextRequest('http://localhost/api/admin/coupons/coupon-1/eligible-users', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await DELETE(makeDeleteReq({ user_id: 'u1' }), { params })
    expect(res.status).toBe(401)
  })

  it('returns 403 when scope missing', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await DELETE(makeDeleteReq({ user_id: 'u1' }), { params })
    expect(res.status).toBe(403)
  })

  it('returns 400 when user_id missing', async () => {
    const res = await DELETE(makeDeleteReq({}), { params })
    expect(res.status).toBe(400)
  })

  it('removes user from eligible list', async () => {
    const res = await DELETE(makeDeleteReq({ user_id: 'u1' }), { params })
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM coupon_eligible_users'),
      ['coupon-1', 'u1'],
    )
  })

  it('returns 500 on db error', async () => {
    vi.mocked(query).mockRejectedValue(new Error('fail'))
    const res = await DELETE(makeDeleteReq({ user_id: 'u1' }), { params })
    expect(res.status).toBe(500)
  })
})
