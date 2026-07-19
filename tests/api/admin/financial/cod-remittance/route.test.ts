import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/invoice', () => ({ generateOrderInvoice: vi.fn().mockResolvedValue(null) }))

import { GET, POST } from '@/app/api/admin/financial/cod-remittance/route'
import { authenticateAdmin } from '@/lib/jwt'
import { queryMany, query } from '@/lib/db'

const ADMIN = { adminId: 'a1', role: 'super_admin', scopes: ['finance'] }

const ORDERS = [
  { id: 'o1', order_number: '1001', customer_name: 'Alice', payment_status: 'cod_collected', delivered_at: '2024-06-03T10:00:00Z', total_amount: '500' },
  { id: 'o2', order_number: '1002', customer_name: 'Bob', payment_status: 'cod_pending', delivered_at: null, total_amount: '200' },
]
const ALL_COD = [
  { payment_status: 'cod_pending', total_amount: '200' },
  { payment_status: 'cod_collected', total_amount: '500' },
  { payment_status: 'paid', total_amount: '300' },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(queryMany).mockResolvedValue([] as any)
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
})

function makeGet(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/financial/cod-remittance')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

function makePost(body: unknown) {
  return new NextRequest('http://localhost/api/admin/financial/cod-remittance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('GET /api/admin/financial/cod-remittance', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
  })

  it('returns orders and summary on happy path', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce(ORDERS as any)
      .mockResolvedValueOnce(ALL_COD as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orders).toBeDefined()
    expect(body.summary).toBeDefined()
    expect(body.summary.cod_pending).toBe(1)
    expect(body.summary.cod_collected).toBe(1)
  })

  it('groups cod_collected orders by delivery week', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce(ORDERS as any)
      .mockResolvedValueOnce(ALL_COD as any)
    const res = await GET(makeGet())
    const body = await res.json()
    expect(Array.isArray(body.weeks)).toBe(true)
    expect(body.weeks.length).toBeGreaterThan(0)
  })

  it('uses status param in query', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([] as any)
    const res = await GET(makeGet({ status: 'cod_pending' }))
    expect(res.status).toBe(200)
  })

  it('handles orders with no delivered_at (skips week grouping)', async () => {
    const orders = [{ id: 'o1', payment_status: 'cod_collected', delivered_at: null, total_amount: '100' }]
    vi.mocked(queryMany)
      .mockResolvedValueOnce(orders as any)
      .mockResolvedValueOnce([] as any)
    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.weeks).toHaveLength(0)
  })

  it('computes total_collected_amount including paid orders', async () => {
    vi.mocked(queryMany)
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce(ALL_COD as any)
    const res = await GET(makeGet())
    const body = await res.json()
    expect(body.summary.total_collected_amount).toBe(800)
  })
})

describe('POST /api/admin/financial/cod-remittance', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost({ orderIds: ['o1'] }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when orderIds missing', async () => {
    const res = await POST(makePost({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when orderIds is empty array', async () => {
    const res = await POST(makePost({ orderIds: [] }))
    expect(res.status).toBe(400)
  })

  it('marks orders as paid and returns success', async () => {
    // UPDATE ... RETURNING id → the two orders that actually flipped to paid
    vi.mocked(query).mockResolvedValueOnce({ rows: [{ id: 'o1' }, { id: 'o2' }] } as any)
    const res = await POST(makePost({ orderIds: ['o1', 'o2'] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.marked).toBe(2)
  })
})
