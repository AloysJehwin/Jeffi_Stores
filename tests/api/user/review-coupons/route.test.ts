import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
}))

import { GET } from '@/app/api/user/review-coupons/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'

const AUTH_USER = { userId: 'user-1' }

function makeGet() {
  return new Request('http://localhost/api/user/review-coupons')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/user/review-coupons', () => {
  it('returns {coupon: null} when unauthenticated', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(null)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.coupon).toBeNull()
  })

  it('returns {coupon: null} when user record not found', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.coupon).toBeNull()
  })

  it('returns {coupon: null} when no matching coupon', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ email: 'u@example.com' } as any)
      .mockResolvedValueOnce(null as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.coupon).toBeNull()
  })

  it('returns coupon when found', async () => {
    const COUPON = { id: 'c1', code: 'REVIEW10', discount_type: 'percent', discount_value: 10 }
    vi.mocked(jwt.authenticateUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce({ email: 'u@example.com' } as any)
      .mockResolvedValueOnce(COUPON as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.coupon.code).toBe('REVIEW10')
    expect(body.coupon.discount_value).toBe(10)
  })
})
