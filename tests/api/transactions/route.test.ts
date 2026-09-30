import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  queryMany: vi.fn(),
  queryCount: vi.fn(),
}))

import { GET } from '@/app/api/transactions/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'

const AUTH_USER = { userId: 'user-1', email: 'u@example.com' }

function makeGet(search = '') {
  return new Request(`http://localhost/api/transactions${search}`)
}

const RAW_TX = {
  id: 'tx-1',
  transaction_id: 'txid-abc',
  payment_method: 'upi',
  payment_gateway: 'razorpay',
  amount: '1500.00',
  status: 'captured',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  order_id: 'order-1',
  order_number: 'ORD-001',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/transactions', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('returns paginated transactions with camelCase mapping', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryMany).mockResolvedValue([RAW_TX] as any)
    vi.mocked(db.queryCount).mockResolvedValue(1 as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transactions).toHaveLength(1)
    expect(body.transactions[0].transactionId).toBe('txid-abc')
    expect(body.transactions[0].paymentMethod).toBe('upi')
    expect(body.transactions[0].amount).toBe(1500)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
    expect(body.pageSize).toBe(10)
  })

  it('handles empty transaction list', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryMany).mockResolvedValue(null as any)
    vi.mocked(db.queryCount).mockResolvedValue(0 as any)

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.transactions).toEqual([])
  })

  it('respects page query param', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryMany).mockResolvedValue([] as any)
    vi.mocked(db.queryCount).mockResolvedValue(0 as any)

    const res = await GET(makeGet('?page=3') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(3)
    // offset should be 20, limit 10
    expect(db.queryMany).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([AUTH_USER.userId, 10, 20]))
  })

  it('clamps page to minimum 1', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryMany).mockResolvedValue([] as any)
    vi.mocked(db.queryCount).mockResolvedValue(0 as any)

    const res = await GET(makeGet('?page=0') as any)
    const body = await res.json()
    expect(body.page).toBe(1)
  })

  it('returns 500 when db throws', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(db.queryMany).mockRejectedValue(new Error('db error'))

    const res = await GET(makeGet() as any)
    expect(res.status).toBe(500)
  })
})
