import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import crypto from 'crypto'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/shared/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { POST } from '@/app/api/admin/financial/payables/webhook/route'
import { query } from '@/lib/shared/db'

// ── Helpers ────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-razorpayx-secret'

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

function makeReq(body: object, signature?: string) {
  const raw = JSON.stringify(body)
  const sig = signature ?? sign(raw, WEBHOOK_SECRET)
  return new NextRequest('http://localhost/api/admin/financial/payables/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': sig,
    },
    body: raw,
  })
}

const mockQuery = vi.mocked(query)

// ── Tests ──────────────────────────────────────────────────────────────────

describe('POST /api/admin/financial/payables/webhook', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.RAZORPAYX_WEBHOOK_SECRET = WEBHOOK_SECRET
    mockQuery.mockResolvedValue([] as any)
  })

  // ── Signature verification ────────────────────────────────────────────────

  it('returns 401 when signature is invalid', async () => {
    const body = { event: 'payout.processed', payload: { payout: { entity: { id: 'p1', status: 'processed' } } } }
    const req = makeReq(body, 'bad-signature')
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/invalid signature/i)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('fails closed with 401 when the signature header is missing', async () => {
    const body = { event: 'payout.processed', payload: { payout: { entity: { id: 'p1', status: 'processed' } } } }
    const raw = JSON.stringify(body)
    const req = new NextRequest('http://localhost/api/admin/financial/payables/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('fails closed with 401 when the webhook secret is not configured', async () => {
    delete process.env.RAZORPAYX_WEBHOOK_SECRET
    const body = { event: 'payout.processed', payload: { payout: { entity: { id: 'p1', status: 'processed' } } } }
    const res = await POST(makeReq(body, 'any-signature'))
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('rejects a valid-length signature that does not match', async () => {
    const body = { event: 'payout.processed', payload: { payout: { entity: { id: 'p1', status: 'processed' } } } }
    const raw = JSON.stringify(body)
    const wrong = sign(raw, 'a-different-secret')
    const res = await POST(makeReq(body, wrong))
    expect(res.status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  // ── Payout with no entity ────────────────────────────────────────────────

  it('returns ok:true when payout entity is missing', async () => {
    const body = { event: 'payout.processed', payload: {} }
    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns ok:true when payout id is missing', async () => {
    const body = { event: 'payout.processed', payload: { payout: { entity: { status: 'processed' } } } }
    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  // ── Known event types ────────────────────────────────────────────────────

  it('updates payout_status on payout.processed', async () => {
    const body = {
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pay_001', status: 'processed' } } },
    }
    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringMatching(/UPDATE expense_payments SET payout_status/), [
      'processed',
      'pay_001',
    ])
  })

  it('updates payout_status on payout.queued', async () => {
    const body = {
      event: 'payout.queued',
      payload: { payout: { entity: { id: 'pay_002', status: 'queued' } } },
    }
    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
  })

  it('updates payout_status on payout.initiated', async () => {
    const body = {
      event: 'payout.initiated',
      payload: { payout: { entity: { id: 'pay_003', status: 'initiated' } } },
    }
    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
  })

  // ── Failed / reversed payout — expense status recalculation ──────────────

  it('recalculates expense status to unpaid when payout fails and no other payments', async () => {
    const body = {
      event: 'payout.failed',
      payload: { payout: { entity: { id: 'pay_004', status: 'failed' } } },
    }
    mockQuery
      .mockResolvedValueOnce([] as any) // UPDATE payout_status
      .mockResolvedValueOnce([{ expense_id: 'exp-1' }] as any) // SELECT expense_id
      .mockResolvedValueOnce([{ paid: '0' }] as any) // SUM paid
      .mockResolvedValueOnce([{ total_amount: '1000' }] as any) // total_amount
      .mockResolvedValueOnce([] as any) // UPDATE expenses status

    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
    // The last query should update status to 'unpaid'
    const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
    expect(lastCall[1]).toContain('unpaid')
  })

  it('recalculates expense status to partial when payout reversed and partial payments', async () => {
    const body = {
      event: 'payout.reversed',
      payload: { payout: { entity: { id: 'pay_005', status: 'reversed' } } },
    }
    mockQuery
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ expense_id: 'exp-2' }] as any)
      .mockResolvedValueOnce([{ paid: '400' }] as any)
      .mockResolvedValueOnce([{ total_amount: '1000' }] as any)
      .mockResolvedValueOnce([] as any)

    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
    const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
    expect(lastCall[1]).toContain('partial')
  })

  it('recalculates expense status to paid when fully paid', async () => {
    const body = {
      event: 'payout.failed',
      payload: { payout: { entity: { id: 'pay_006', status: 'failed' } } },
    }
    mockQuery
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([{ expense_id: 'exp-3' }] as any)
      .mockResolvedValueOnce([{ paid: '1000' }] as any)
      .mockResolvedValueOnce([{ total_amount: '1000' }] as any)
      .mockResolvedValueOnce([] as any)

    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
    const lastCall = mockQuery.mock.calls[mockQuery.mock.calls.length - 1]
    expect(lastCall[1]).toContain('paid')
  })

  // ── Unrecognised event type ───────────────────────────────────────────────

  it('returns ok:true but does not update for unknown event type', async () => {
    const body = {
      event: 'payout.unknown_event',
      payload: { payout: { entity: { id: 'pay_007', status: 'unknown' } } },
    }
    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  // ── Valid signature accepted ───────────────────────────────────────────────

  it('accepts request with valid signature', async () => {
    const body = {
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pay_008', status: 'processed' } } },
    }
    // makeReq signs with WEBHOOK_SECRET by default — should accept
    const res = await POST(makeReq(body))
    expect(res.status).toBe(200)
  })

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns 500 on db error', async () => {
    const body = {
      event: 'payout.processed',
      payload: { payout: { entity: { id: 'pay_009', status: 'processed' } } },
    }
    mockQuery.mockRejectedValue(new Error('DB failure'))
    const res = await POST(makeReq(body))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB failure')
  })
})
