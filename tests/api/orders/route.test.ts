import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryCount: vi.fn(),
  queryOne: vi.fn(),
}))

import { GET } from '@/app/api/(public)/orders/route'
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

describe('GET /api/orders — identity boundary (user_id + email/phone, source-scoped)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Pull the SQL string the route passed to queryMany, plus the params.
  function capturedQuery() {
    const call = vi.mocked(db.queryMany).mock.calls[0]
    return { sql: String(call[0]), params: call[1] as any[] }
  }
  function capturedCount() {
    const call = vi.mocked(db.queryCount).mock.calls[0]
    return { sql: String(call[0]), params: call[1] as any[] }
  }

  it('looks up the account email+phone for a regular customer', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ email: 'me@example.com', phone: '9000000000' })
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    vi.mocked(db.queryCount).mockResolvedValueOnce(0)
    await GET(makeRequest() as any)
    expect(db.queryOne).toHaveBeenCalledWith(expect.stringContaining('SELECT email, phone FROM users'), ['user-1'])
  })

  it('customer query matches user_id OR email+phone, but EXCLUDES business-source', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ email: 'me@example.com', phone: '9000000000' })
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    vi.mocked(db.queryCount).mockResolvedValueOnce(0)
    await GET(makeRequest() as any)

    const { sql, params } = capturedQuery()
    // own orders by user_id
    expect(sql).toContain('o.user_id = $1')
    // email+phone fallback, both required
    expect(sql).toContain('o.customer_email = $2')
    expect(sql).toContain('o.customer_phone = $3')
    expect(sql).toContain('$3::text IS NOT NULL')
    // the fallback must be scoped away from business-source orders (null-safe)
    expect(sql).toContain("o.source IS DISTINCT FROM 'business'")
    // params carry id, email, phone (then limit, offset)
    expect(params.slice(0, 3)).toEqual(['user-1', 'me@example.com', '9000000000'])

    // the count query enforces the same boundary
    expect(capturedCount().sql).toContain("o.source IS DISTINCT FROM 'business'")
  })

  it('business query matches user_id OR email+phone and does NOT exclude business-source', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(BIZ_USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ email: 'biz@example.com', phone: '9111111111' })
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    vi.mocked(db.queryCount).mockResolvedValueOnce(0)
    await GET(makeRequest() as any)

    const { sql, params } = capturedQuery()
    expect(sql).toContain('o.user_id = $1')
    expect(sql).toContain('o.customer_email = $2')
    expect(sql).toContain('o.customer_phone = $3')
    // business portal must NOT carry the customer-only source exclusion
    expect(sql).not.toContain("o.source IS DISTINCT FROM 'business'")
    expect(params.slice(0, 3)).toEqual(['biz-user-1', 'biz@example.com', '9111111111'])
  })

  it('email+phone fallback requires BOTH (null phone cannot match via the $3 IS NOT NULL guard)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ email: 'me@example.com', phone: null })
    vi.mocked(db.queryMany).mockResolvedValueOnce([])
    vi.mocked(db.queryCount).mockResolvedValueOnce(0)
    await GET(makeRequest() as any)

    const { sql, params } = capturedQuery()
    // the SQL always guards on $3 IS NOT NULL, so a null phone param neutralises the fallback
    expect(sql).toContain('$3::text IS NOT NULL')
    expect(params[2]).toBeNull()
  })
})
