import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
  withTransaction: vi.fn(),
}))
vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn(),
  sendNewOrderNotification: vi.fn(),
  sendPaymentStatusUpdate: vi.fn(),
}))
vi.mock('@/lib/auto-tasks', () => ({ createAutoTask: vi.fn() }))
vi.mock('@/lib/marketing', () => ({ attributeConversion: vi.fn() }))

import { POST } from '@/app/api/webhooks/razorpay/route'
import { query, queryOne, queryMany, withTransaction } from '@/lib/db'
import crypto from 'crypto'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)
const mockWithTransaction = vi.mocked(withTransaction)
const mockQuery = vi.mocked(query)

const SECRET = 'test-webhook-secret'

function makeRequest(body: object, signature?: string): Request {
  const raw = JSON.stringify(body)
  const sig = signature ?? crypto.createHmac('sha256', SECRET).update(raw).digest('hex')
  return new Request('http://localhost/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': sig,
    },
    body: raw,
  })
}

describe('POST /api/webhooks/razorpay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET
  })

  it('returns 400 when signature header is missing', async () => {
    const req = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      body: JSON.stringify({ event: 'payment.captured' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Missing signature')
  })

  it('returns 400 when signature is invalid', async () => {
    const req = makeRequest({ event: 'payment.captured' }, 'bad-sig')
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe('Invalid signature')
  })

  it('returns ok for unknown event type', async () => {
    const req = makeRequest({ event: 'unknown.event', payload: {} })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
  })

  it('handles payment.captured — skips if already paid', async () => {
    mockQueryOne.mockResolvedValueOnce({ payment_status: 'paid', order_id: 'ord1' })
    const body = {
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 'rp_ord1', id: 'pay1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('handles payment.captured — processes new payment with user', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        payment_status: 'unpaid',
        order_id: 'ord1',
        user_id: 'user1',
        payment_record_status: 'pending',
      })
      .mockResolvedValueOnce({ id: 'user1', email: 'u@e.com', first_name: 'A', last_name: 'B' })
      .mockResolvedValueOnce({ id: 'ord1', order_number: '#1', total_amount: '100' })
    mockQueryMany.mockResolvedValueOnce([{ id: 'item1' }])
    mockWithTransaction.mockResolvedValueOnce(undefined)

    const body = {
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 'rp_ord1', id: 'pay1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(mockWithTransaction).toHaveBeenCalled()
  })

  it('handles payment.captured — no user_id skips email', async () => {
    mockQueryOne.mockResolvedValueOnce({
      payment_status: 'unpaid',
      order_id: 'ord1',
      user_id: null,
    })
    mockWithTransaction.mockResolvedValueOnce(undefined)

    const body = {
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 'rp_ord1', id: 'pay1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('handles payment.captured — no payment record', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const body = {
      event: 'payment.captured',
      payload: { payment: { entity: { order_id: 'rp_ord1', id: 'pay1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
  })

  it('handles payment.failed — no record', async () => {
    mockQueryOne.mockResolvedValueOnce(null)
    const body = {
      event: 'payment.failed',
      payload: { payment: { entity: { order_id: 'rp_ord1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
  })

  it('handles payment.failed — creates auto task if user_id', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ order_id: 'ord1' })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ user_id: 'user1', order_number: '#1', total_amount: '100' })

    const body = {
      event: 'payment.failed',
      payload: { payment: { entity: { order_id: 'rp_ord1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
  })

  it('handles payment_link.paid — already paid', async () => {
    mockQueryOne.mockResolvedValueOnce({ payment_status: 'paid', id: 'ord1', user_id: null })
    const body = {
      event: 'payment_link.paid',
      payload: { payment_link: { entity: { id: 'link1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(mockWithTransaction).not.toHaveBeenCalled()
  })

  it('handles payment_link.paid — processes with user', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ payment_status: 'unpaid', id: 'ord1', user_id: 'u1', total_amount: '200', order_number: '#2' })
      .mockResolvedValueOnce({ id: 'u1', email: 'u@e.com', first_name: 'A', last_name: 'B' })
      .mockResolvedValueOnce({ id: 'ord1' })
    mockQueryMany.mockResolvedValueOnce([])
    mockWithTransaction.mockResolvedValueOnce(undefined)

    const body = {
      event: 'payment_link.paid',
      payload: { payment_link: { entity: { id: 'link1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(mockWithTransaction).toHaveBeenCalled()
  })

  it('handles payment_link.expired', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ord1' })
    const body = {
      event: 'payment_link.expired',
      payload: { payment_link: { entity: { id: 'link1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
  })

  it('handles qr_code.credited — no qr id', async () => {
    const body = {
      event: 'qr_code.credited',
      payload: { qr_code: { entity: {} } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('handles qr_code.credited — with qr id', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'ord1', payment_status: 'unpaid', total_amount: '500' } as any)
    mockQuery.mockResolvedValueOnce(undefined as any)
    mockQuery.mockResolvedValueOnce(undefined as any)
    const body = {
      event: 'qr_code.credited',
      payload: { qr_code: { entity: { id: 'qr1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalled()
  })

  it('returns 500 when RAZORPAY_WEBHOOK_SECRET is unset', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    const body = { event: 'unknown.event', payload: {} }
    const raw = JSON.stringify(body)
    const req = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': 'any' },
      body: raw,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe('Webhook not configured')
  })

  it('returns ok on thrown exception (catch-all)', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('db error'))
    const body = {
      event: 'payment.failed',
      payload: { payment: { entity: { order_id: 'rp_ord1' } } },
    }
    const req = makeRequest(body)
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.status).toBe('ok')
  })
})
