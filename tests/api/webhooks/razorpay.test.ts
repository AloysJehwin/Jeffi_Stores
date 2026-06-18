import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn().mockResolvedValue(null),
  queryMany: vi.fn().mockResolvedValue([]),
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  withTransaction: vi.fn().mockImplementation(async (fn: any) =>
    fn({ query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })
  ),
}))

vi.mock('@/lib/email', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendNewOrderNotification: vi.fn().mockResolvedValue(undefined),
  sendPaymentStatusUpdate: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auto-tasks', () => ({
  createAutoTask: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/marketing', () => ({
  attributeConversion: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------

import { POST } from '@/app/api/webhooks/razorpay/route'

const WEBHOOK_SECRET = 'test-webhook-secret'

function buildSignedRequest(body: string, secret = WEBHOOK_SECRET) {
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
  return new Request('http://localhost/api/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': sig,
    },
    body,
  })
}

beforeEach(() => {
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET
})

describe('POST /api/webhooks/razorpay', () => {
  it('returns 400 when x-razorpay-signature header is missing', async () => {
    const req = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'payment.captured' }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/signature/i)
  })

  it('returns 400 when signature does not match', async () => {
    const payload = JSON.stringify({ event: 'payment.captured', payload: {} })
    const req = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': 'totally-wrong-sig',
      },
      body: payload,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/signature/i)
  })

  it('returns 200 ok for a valid payment.captured event', async () => {
    const payload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: { id: 'pay_123', order_id: 'order_abc', amount: 10000 },
        },
      },
    })
    const res = await POST(buildSignedRequest(payload) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('returns 200 ok for a valid payment.failed event', async () => {
    const payload = JSON.stringify({
      event: 'payment.failed',
      payload: {
        payment: {
          entity: { id: 'pay_456', order_id: 'order_def' },
        },
      },
    })
    const res = await POST(buildSignedRequest(payload) as any)
    expect(res.status).toBe(200)
  })

  it('returns 200 ok for an unhandled event type (graceful)', async () => {
    const payload = JSON.stringify({ event: 'refund.processed', payload: {} })
    const res = await POST(buildSignedRequest(payload) as any)
    expect(res.status).toBe(200)
  })

  it('processes without secret check when RAZORPAY_WEBHOOK_SECRET is not set', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET
    const payload = JSON.stringify({
      event: 'payment_link.expired',
      payload: { payment_link: { entity: { id: 'plink_123' } } },
    })
    const req = new Request('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': 'any-sig-ignored',
      },
      body: payload,
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
  })
})
