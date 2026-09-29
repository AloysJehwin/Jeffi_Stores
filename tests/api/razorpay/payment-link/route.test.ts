import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/jwt', () => ({
  authenticateAdmin: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  resolveRequestTenant: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/razorpay', () => ({
  getRazorpayInstanceFor: vi.fn(),
}))

import { POST } from '@/app/api/razorpay/payment-link/route'
import * as jwt from '@/lib/jwt'
import * as db from '@/lib/db'
import * as razorpayLib from '@/lib/razorpay'

function rzpMock(impl: Record<string, unknown>) {
  vi.mocked(razorpayLib.getRazorpayInstanceFor).mockResolvedValue({ instance: { paymentLink: impl } } as any)
}

const ADMIN = { adminId: 'admin-1', username: 'admin', role: 'super_admin', scopes: [] }

const MOCK_ORDER = {
  id: 'order-123',
  order_number: 'ORD-001',
  total_amount: '500',
  customer_name: 'Test User',
  customer_email: 'test@example.com',
  customer_phone: '9999999999',
  payment_status: 'unpaid',
  payment_link_id: null,
  payment_link_status: null,
}

const MOCK_PAYMENT_LINK = {
  id: 'plink_123',
  short_url: 'https://rzp.io/l/abc',
}

function makeRequest(body: unknown = { orderId: 'order-123' }) {
  return new Request('http://localhost/api/razorpay/payment-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/razorpay/payment-link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not admin', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(null)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(401)
  })

  it('returns 400 when orderId missing', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    const res = await POST(makeRequest({}) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/orderId required/i)
  })

  it('returns 404 when order not found', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(null)
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(404)
  })

  it('returns 409 when order already paid', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce({ ...MOCK_ORDER, payment_status: 'paid' })
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/already paid/i)
  })

  it('creates payment link successfully', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(null) // UPDATE returns null via queryOne
    const mockCreate = vi.fn().mockResolvedValue(MOCK_PAYMENT_LINK)
    rzpMock({ create: mockCreate })
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.paymentLinkId).toBe('plink_123')
    expect(body.paymentLinkUrl).toBe('https://rzp.io/l/abc')
    expect(body.expiresAt).toBeDefined()
  })

  it('returns existing payment link when one is already created', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    const orderWithLink = {
      ...MOCK_ORDER,
      payment_link_id: 'plink_existing',
      payment_link_status: 'created',
      payment_link_url: 'https://rzp.io/l/existing',
    }
    vi.mocked(db.queryOne).mockResolvedValueOnce(orderWithLink)
    const mockFetch = vi.fn().mockResolvedValue({ status: 'created' })
    rzpMock({ fetch: mockFetch })
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.alreadyExists).toBe(true)
    expect(body.paymentLinkId).toBe('plink_existing')
  })

  it('creates new link when existing one is expired', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    const orderWithExpiredLink = {
      ...MOCK_ORDER,
      payment_link_id: 'plink_expired',
      payment_link_status: 'created',
    }
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(orderWithExpiredLink)
      .mockResolvedValueOnce(null)
    const mockFetch = vi.fn().mockResolvedValue({ status: 'expired' })
    const mockCreate = vi.fn().mockResolvedValue(MOCK_PAYMENT_LINK)
    rzpMock({ fetch: mockFetch, create: mockCreate })
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(200)
    expect(mockCreate).toHaveBeenCalled()
  })

  it('respects custom expiryHours', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne)
      .mockResolvedValueOnce(MOCK_ORDER)
      .mockResolvedValueOnce(null)
    const mockCreate = vi.fn().mockResolvedValue(MOCK_PAYMENT_LINK)
    rzpMock({ create: mockCreate })
    await POST(makeRequest({ orderId: 'order-123', expiryHours: 24 }) as any)
    const createCall = mockCreate.mock.calls[0][0]
    expect(createCall).toHaveProperty('expire_by')
  })

  it('returns 500 on razorpay error', async () => {
    vi.mocked(jwt.authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(db.queryOne).mockResolvedValueOnce(MOCK_ORDER)
    rzpMock({ create: vi.fn().mockRejectedValue(new Error('Gateway error')) })
    const res = await POST(makeRequest() as any)
    expect(res.status).toBe(500)
  })
})
