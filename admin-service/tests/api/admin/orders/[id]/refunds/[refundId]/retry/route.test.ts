import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ resolveRequestTenant: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/payments/razorpay', () => ({ getRazorpayInstanceFor: vi.fn() }))
vi.mock('@/lib/payments/route-settlement', () => ({ applyRouteRefund: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/orders/[id]/refunds/[refundId]/retry/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { resolveRequestTenant, withTransaction } from '@/lib/shared/db'
import { getRazorpayInstanceFor } from '@/lib/payments/razorpay'
import { applyRouteRefund } from '@/lib/payments/route-settlement'

const admin = { adminId: 'a1', username: 'admin', role: 'admin', scopes: [] }
const call = () =>
  POST(new NextRequest('http://localhost/x', { method: 'POST' }), {
    params: Promise.resolve({ id: 'o1', refundId: 'r1' }),
  })
const failedRow = {
  id: 'r1',
  razorpay_refund_id: 'rfnd_old',
  razorpay_payment_id: 'pay_1',
  payment_id: 'p1',
  amount: '123.45',
  purpose: 'cancel',
  order_number: 'ORD-1',
}

// Runs the route's transaction callback against a scripted client.
function useClient(selectRows: unknown[], retriedCount = 0) {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      if (/FROM payment_refunds r JOIN/.test(sql)) return { rows: selectRows }
      if (/retry_of = \$1/.test(sql)) return { rowCount: retriedCount }
      return { rows: [], rowCount: 1 }
    }),
  }
  vi.mocked(withTransaction).mockImplementation((async (fn: (c: unknown) => unknown) => fn(client)) as never)
  return client
}

describe('POST /api/admin/orders/[id]/refunds/[refundId]/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue(admin)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(resolveRequestTenant).mockResolvedValue({ tenantId: 't1' } as never)
    vi.mocked(applyRouteRefund).mockResolvedValue(undefined as never)
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('returns 403 without orders:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await call()).status).toBe(403)
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('returns 404 when no failed refund matches', async () => {
    useClient([])
    expect((await call()).status).toBe(404)
    expect(getRazorpayInstanceFor).not.toHaveBeenCalled()
  })

  it('returns 409 when the refund was already retried', async () => {
    useClient([failedRow], 1)
    expect((await call()).status).toBe(409)
    expect(getRazorpayInstanceFor).not.toHaveBeenCalled()
  })

  it('refunds the exact failed amount in paise and records the retry', async () => {
    const client = useClient([failedRow])
    const refund = vi.fn().mockResolvedValue({ id: 'rfnd_new', status: 'processed', speed_requested: 'normal' })
    vi.mocked(getRazorpayInstanceFor).mockResolvedValue({ instance: { payments: { refund } } } as never)
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, refundId: 'rfnd_new', status: 'processed' })
    expect(getRazorpayInstanceFor).toHaveBeenCalledWith('t1')
    expect(refund).toHaveBeenCalledWith('pay_1', { amount: 12345, notes: { purpose: 'cancel', retry_of: 'rfnd_old' } })
    const insert = client.query.mock.calls.find(c => /INSERT INTO payment_refunds/.test(c[0] as string))!
    expect(insert[1]).toEqual(['rfnd_new', 'pay_1', 'p1', 'o1', 123.45, 'processed', 'normal', 'cancel', 'r1'])
    expect(applyRouteRefund).toHaveBeenCalledWith({
      tenantId: 't1',
      paymentId: 'pay_1',
      refundId: 'rfnd_new',
      refundPaise: 12345,
      orderRef: 'ORD-1',
    })
  })

  it('records a non-processed retry as pending and survives a settlement error', async () => {
    const client = useClient([failedRow])
    vi.mocked(getRazorpayInstanceFor).mockResolvedValue({
      instance: { payments: { refund: vi.fn().mockResolvedValue({ id: 'rfnd_n', status: 'created' }) } },
    } as never)
    vi.mocked(applyRouteRefund).mockRejectedValue(new Error('settle'))
    const res = await call()
    expect(res.status).toBe(200)
    const insert = client.query.mock.calls.find(c => /INSERT INTO payment_refunds/.test(c[0] as string))!
    expect((insert[1] as unknown[])[5]).toBe('pending')
  })

  it('returns 500 with the gateway description when Razorpay fails', async () => {
    useClient([failedRow])
    vi.mocked(getRazorpayInstanceFor).mockResolvedValue({
      instance: { payments: { refund: vi.fn().mockRejectedValue({ error: { description: 'Insufficient balance' } }) } },
    } as never)
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('Insufficient balance')
    expect(applyRouteRefund).not.toHaveBeenCalled()
  })
})
