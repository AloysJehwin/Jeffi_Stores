import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 1 })), queryOne: vi.fn() }))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: vi.fn(async () => {}), completeAutoTask: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ sendDisputeAdminEmail: vi.fn(async () => {}) }))

import { upsertDispute, followUpDispute, isNewDisputeAlert, syncDisputes, type DisputeRow } from '@/lib/payments/dispute-records'
import { query, queryOne } from '@/lib/shared/db'
import { createAdminNotification } from '@/lib/shared/admin-notify'
import { createAutoTask, completeAutoTask } from '@/lib/shared/auto-tasks'
import { sendDisputeAdminEmail } from '@/lib/email'

const row = (over: Partial<DisputeRow> = {}): DisputeRow => ({
  id: 'd1',
  razorpay_dispute_id: 'disp_1',
  razorpay_payment_id: 'pay_1',
  order_id: 'o1',
  amount: '499.00',
  status: 'open',
  respond_by: new Date(Date.now() + 2 * 86400000).toISOString(),
  prev_status: null,
  prev_event: null,
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('upsertDispute', () => {
  it('records the dispute against the local payment and flags the order', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce({ id: 'p1', order_id: 'o1' } as any)
      .mockResolvedValueOnce(row({ status: 'under_review' }) as any)
    const r = await upsertDispute({ id: 'disp_1', payment_id: 'pay_1', amount: 49900, status: 'under_review', respond_by: 1_800_000_000 }, null)
    expect(r?.status).toBe('under_review')
    const params = vi.mocked(queryOne).mock.calls[1][1]!
    expect(params.slice(0, 6)).toEqual(['disp_1', 'pay_1', 'p1', 'o1', 499, 0])
    expect(params[9]).toBe('under_review')
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(['under_review', 'o1'])
  })

  it('takes the status from the event when the entity has none, and skips foreign payments when asked', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null).mockResolvedValueOnce(row({ order_id: null, status: 'lost' }) as any)
    await upsertDispute({ id: 'disp_1', payment_id: 'pay_1', amount: 100 }, 'payment.dispute.lost')
    expect(vi.mocked(queryOne).mock.calls[1][1]![9]).toBe('lost')
    expect(query).not.toHaveBeenCalled()

    vi.mocked(queryOne).mockResolvedValueOnce(null)
    await expect(upsertDispute({ id: 'disp_2', payment_id: 'pay_2' }, null, { requireLocalPayment: true })).resolves.toBeNull()
    await expect(upsertDispute({ id: 'disp_3' }, null)).resolves.toBeNull()
  })
})

describe('isNewDisputeAlert', () => {
  it('alerts on a new dispute and again when action is required', () => {
    expect(isNewDisputeAlert(row(), 'payment.dispute.created')).toBe(true)
    expect(isNewDisputeAlert(row({ prev_status: 'open', prev_event: 'payment.dispute.created' }), 'payment.dispute.created')).toBe(false)
    expect(isNewDisputeAlert(row({ prev_status: 'open', prev_event: 'payment.dispute.created' }), 'payment.dispute.action_required')).toBe(true)
    expect(isNewDisputeAlert(row({ status: 'won' }), 'payment.dispute.won')).toBe(false)
  })
})

describe('followUpDispute', () => {
  it('raises an urgent task, a critical alert and an email for a new dispute near its deadline', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({ order_number: 'ORD-7', user_id: 'u1' } as any)
    await followUpDispute(row(), 'payment.dispute.created')
    expect(createAdminNotification).toHaveBeenCalledWith(expect.objectContaining({ severity: 'critical', entityId: 'd1' }))
    expect(createAutoTask).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: 'respond_dispute', priority: 'urgent', userId: 'u1' }))
    expect(sendDisputeAdminEmail).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: 'ORD-7', amount: 499 }))
  })

  it('completes the task once the dispute is decided', async () => {
    await followUpDispute(row({ status: 'won' }), 'payment.dispute.won')
    expect(completeAutoTask).toHaveBeenCalledWith('respond_dispute', 'd1')
    expect(createAdminNotification).not.toHaveBeenCalled()
  })

  it('alerts without a task when the payment has no order here', async () => {
    await followUpDispute(row({ order_id: null, respond_by: null }), null)
    expect(createAdminNotification).toHaveBeenCalledWith(expect.objectContaining({ link: '/admin/financial?tab=disputes' }))
    expect(createAutoTask).not.toHaveBeenCalled()
  })
})

describe('syncDisputes', () => {
  it('keeps only disputes on this store’s payments', async () => {
    const disputes = { all: vi.fn().mockResolvedValue({ items: [{ id: 'disp_1', payment_id: 'pay_1' }, { id: 'disp_2', payment_id: 'pay_x' }] }) }
    vi.mocked(queryOne).mockImplementation(async (sql: string, p?: any[]) => {
      if (/FROM payments/.test(sql)) return (p?.[0] === 'pay_1' ? { id: 'p1', order_id: 'o1' } : null) as any
      if (/payment_disputes/.test(sql)) return row({ status: 'closed' }) as any
      return null
    })
    await expect(syncDisputes({ disputes })).resolves.toEqual({ seen: 2, saved: 1 })
    expect(completeAutoTask).toHaveBeenCalledTimes(1)
  })
})
