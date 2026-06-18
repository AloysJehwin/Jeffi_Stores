import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateUser: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
}))
vi.mock('@/lib/return-policy', () => ({
  getOrderItemsPolicy: vi.fn(),
}))

import { GET } from '@/app/api/orders/[id]/return-policy/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as returnPolicy from '@/lib/return-policy'
import type { OrderItemPolicy } from '@/lib/return-policy'

const USER = { userId: 'user-1' }
const PARAMS = { params: { id: 'order-123' } }

const MOCK_ORDER_DELIVERED = {
  id: 'order-123',
  status: 'delivered',
  delivered_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
  updated_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
}

const MOCK_ITEMS_ELIGIBLE: OrderItemPolicy[] = [
  {
    product_id: 'prod-1',
    product_name: 'Test Product',
    source: 'default',
    return_allowed: true,
    replacement_allowed: true,
    return_window_days: 7,
    replacement_window_days: 7,
  },
]

const MOCK_ITEMS_NO_RETURN: OrderItemPolicy[] = [
  {
    product_id: 'prod-1',
    product_name: 'Non-Returnable Product',
    source: 'default',
    return_allowed: false,
    replacement_allowed: true,
    return_window_days: 7,
    replacement_window_days: 7,
  },
]

function makeRequest() {
  return new Request('http://localhost/api/orders/order-123/return-policy', { method: 'GET' })
}

describe('GET /api/orders/[id]/return-policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(null)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns not eligible when order not delivered', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER_DELIVERED, status: 'confirmed' })
    vi.mocked(returnPolicy.getOrderItemsPolicy).mockResolvedValueOnce(MOCK_ITEMS_ELIGIBLE)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refund.allowed).toBe(false)
    expect(body.refund.reason).toMatch(/not delivered/i)
  })

  it('returns eligible for refund and replacement within window', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER_DELIVERED)
    vi.mocked(returnPolicy.getOrderItemsPolicy).mockResolvedValueOnce(MOCK_ITEMS_ELIGIBLE)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refund.allowed).toBe(true)
    expect(body.replacement.allowed).toBe(true)
    expect(body.items).toHaveLength(1)
  })

  it('returns refund not allowed when product blocks it', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER_DELIVERED)
    vi.mocked(returnPolicy.getOrderItemsPolicy).mockResolvedValueOnce(MOCK_ITEMS_NO_RETURN)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refund.allowed).toBe(false)
    expect(body.refund.reason).toMatch(/not allowed/i)
    expect(body.replacement.allowed).toBe(true)
  })

  it('returns window expired when past return window', async () => {
    const oldDelivery = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER_DELIVERED, delivered_at: oldDelivery })
    vi.mocked(returnPolicy.getOrderItemsPolicy).mockResolvedValueOnce(MOCK_ITEMS_ELIGIBLE)
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refund.allowed).toBe(false)
    expect(body.refund.reason).toMatch(/window.*closed/i)
  })

  it('returns empty items as not eligible', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER_DELIVERED)
    vi.mocked(returnPolicy.getOrderItemsPolicy).mockResolvedValueOnce([])
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.refund.allowed).toBe(false)
    expect(body.replacement.allowed).toBe(false)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))
    const res = await GET(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
