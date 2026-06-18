import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryMany: vi.fn(),
  queryOne: vi.fn(),
}))

import { GET } from '@/app/api/user/dashboard/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'

const AUTH_USER = { userId: 'user-1' }

const STATS = { total_orders: 5, total_spent: 9999, active_orders: 1 }
const RECENT_ORDERS = [{ id: 'o1', order_number: 'ORD-001', status: 'confirmed' }]
const DEFAULT_ADDRESS = { city: 'Mumbai', state: 'MH' }
const WISHLIST_COUNT = { count: 3 }

function makeGet() {
  return new Request('http://localhost/api/user/dashboard')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/user/dashboard', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(401)
  })

  it('returns dashboard data when authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(STATS as any)
      .mockResolvedValueOnce(DEFAULT_ADDRESS as any)
      .mockResolvedValueOnce(WISHLIST_COUNT as any)
    vi.mocked(db.queryMany).mockResolvedValue(RECENT_ORDERS as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats.total_orders).toBe(5)
    expect(body.recentOrders).toHaveLength(1)
    expect(body.defaultAddress.city).toBe('Mumbai')
    expect(body.wishlistCount).toBe(3)
  })

  it('returns defaults when all queries return null', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockResolvedValue(null as any)
    vi.mocked(db.queryMany).mockResolvedValue(null as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.stats).toEqual({ total_orders: 0, total_spent: 0, active_orders: 0 })
    expect(body.recentOrders).toEqual([])
    expect(body.defaultAddress).toBeNull()
    expect(body.wishlistCount).toBe(0)
  })

  it('returns 500 when db throws', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('db error'))
    vi.mocked(db.queryMany).mockRejectedValue(new Error('db error'))

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(500)
  })
})
