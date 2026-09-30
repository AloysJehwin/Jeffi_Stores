import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryCount: vi.fn(),
  queryOne: vi.fn(),
}))

import { GET } from '@/app/api/orders/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'

const USER = { userId: 'user-1', isBusiness: false }
const BIZ_USER = { userId: 'biz-user-1', isBusiness: true }

const MOCK_ORDERS = [
  {
    id: 'order-1',
    order_number: 'ORD-001',
    created_at: '2024-01-01T00:00:00Z',
    status: 'confirmed',
    payment_status: 'paid',
    total_amount: '500',
    order_items: [],
    addresses: null,
  },
]

function makeRequest(params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/orders')
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  return new Request(url.toString(), { method: 'GET', headers })
}

describe('GET /api/orders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns paginated orders for regular user', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryMany).mockResolvedValueOnce(MOCK_ORDERS)
    vi.mocked(db.queryCount).mockResolvedValueOnce(1)
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders).toHaveLength(1)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(10)
  })

  it('returns page 2 correctly', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    vi.mocked(db.queryCount).mockResolvedValueOnce(15)
    const res = await GET(makeRequest({ page: '2' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(2)
  })

  it('clamps page to minimum 1 for invalid values', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    vi.mocked(db.queryCount).mockResolvedValueOnce(0)
    const res = await GET(makeRequest({ page: '-5' }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(1)
  })

  it('uses business query when isBusiness is true', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(BIZ_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ email: 'biz@example.com', phone: '9999999999' })
    vi.mocked(db.queryMany).mockResolvedValueOnce(MOCK_ORDERS)
    vi.mocked(db.queryCount).mockResolvedValueOnce(1)
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(200)
    expect(db.queryOne).toHaveBeenCalledWith(expect.stringContaining('SELECT email, phone FROM users'), ['biz-user-1'])
  })

  it('uses business query when x-auth-portal header is business', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue({ userId: 'user-1', isBusiness: false } as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ email: 'user@example.com', phone: null })
    vi.mocked(db.queryMany).mockResolvedValueOnce(MOCK_ORDERS)
    vi.mocked(db.queryCount).mockResolvedValueOnce(1)
    const res = await GET(makeRequest({}, { 'x-auth-portal': 'business' }) as any)
    expect(res.status).toBe(200)
    expect(db.queryOne).toHaveBeenCalled()
  })

  it('returns empty orders array with zero total', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    vi.mocked(db.queryCount).mockResolvedValueOnce(0)
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryMany).mockRejectedValue(new Error('DB error'))
    const res = await GET(makeRequest() as any)
    expect(res.status).toBe(500)
  })
})
