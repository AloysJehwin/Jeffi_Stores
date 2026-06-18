import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/orders', () => ({
  cancelOrder: vi.fn(),
}))

import { POST } from '@/app/api/orders/[id]/cancel/route'
import * as jwt from '@/lib/jwt'
import * as orders from '@/lib/orders'

// ------------------------------------------------------------------ helpers

function makeRequest(body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/orders/order-123/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const AUTH_USER = { userId: 'user-456', email: 'test@example.com' }
const PARAMS = { params: { id: 'order-123' } }

// ------------------------------------------------------------------ tests

describe('POST /api/orders/[id]/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)

    const res = await POST(makeRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toMatch(/unauthorized/i)
  })

  it('cancels a pending order and returns 200 for the owner', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orders.cancelOrder).mockResolvedValue({
      success: true,
      orderId: 'order-123',
      message: 'Order cancelled',
    } as any)

    const res = await POST(makeRequest({}) as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(orders.cancelOrder).toHaveBeenCalledWith(
      'order-123',
      expect.objectContaining({ expectedUserId: AUTH_USER.userId })
    )
  })

  it('returns 400 when order is already shipped (cannot cancel)', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orders.cancelOrder).mockResolvedValue({
      success: false,
      error: 'Order is already shipped',
      status: 400,
    } as any)

    const res = await POST(makeRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/shipped/i)
  })

  it('returns 403 when a non-owner tries to cancel', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orders.cancelOrder).mockResolvedValue({
      success: false,
      error: 'Forbidden',
      status: 403,
    } as any)

    const res = await POST(makeRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/forbidden/i)
  })

  it('passes restoreToCart flag through to cancelOrder', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orders.cancelOrder).mockResolvedValue({ success: true } as any)

    await POST(makeRequest({ restoreToCart: true }) as any, PARAMS)

    expect(orders.cancelOrder).toHaveBeenCalledWith(
      'order-123',
      expect.objectContaining({ restoreToCart: true })
    )
  })

  it('returns 500 when cancelOrder throws', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(AUTH_USER as any)
    vi.mocked(orders.cancelOrder).mockRejectedValue(new Error('DB error'))

    const res = await POST(makeRequest() as any, PARAMS)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toMatch(/failed/i)
  })
})
