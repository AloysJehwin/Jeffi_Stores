import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/jwt', () => ({
  authenticateAnyUser: vi.fn(),
}))
vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
  sendPaymentFailedAdminNotification: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shared/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/shared/activity', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}))

import { POST } from '@/app/api/(public)/orders/[id]/payment-failed/route'
import * as jwt from '@/lib/auth/jwt'
import * as db from '@/lib/shared/db'

const USER = { userId: 'user-1' }
const PARAMS = { params: Promise.resolve({ id: 'order-123' }) }

const MOCK_ORDER = {
  id: 'order-123',
  order_number: 'ORD-001',
  status: 'pending',
  payment_status: 'unpaid',
  total_amount: '500',
  customer_name: 'Test User',
  customer_email: 'test@example.com',
  customer_phone: '9999999999',
  users: { email: 'test@example.com', first_name: 'Test', last_name: 'User' },
}

function makeRequest(body: unknown = {}) {
  return new Request('http://localhost/api/orders/order-123/payment-failed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/orders/[id]/payment-failed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
  })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(null)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 200 immediately when order already paid', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER, payment_status: 'paid' })
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    // Should not update DB when already paid
    expect(db.query).not.toHaveBeenCalled()
  })

  it('returns 200 immediately when order already cancelled', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER, status: 'cancelled' })
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(200)
    expect(db.query).not.toHaveBeenCalled()
  })

  it('records payment failure and returns success', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    const res = await POST(makeRequest({ errorDescription: 'Insufficient funds' }) as any, PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(db.query).toHaveBeenCalledTimes(2)
  })

  it('handles missing body gracefully', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    const req = new Request('http://localhost/api/orders/order-123/payment-failed', {
      method: 'POST',
    })
    const res = await POST(req as any, PARAMS)
    expect(res.status).toBe(200)
  })

  it('returns 500 on unexpected error', async () => {
    vi.mocked(jwt.authenticateAnyUser).mockResolvedValue(USER as any)
    vi.mocked(db.queryOne).mockRejectedValue(new Error('DB error'))
    const res = await POST(makeRequest() as any, PARAMS)
    expect(res.status).toBe(500)
  })
})
