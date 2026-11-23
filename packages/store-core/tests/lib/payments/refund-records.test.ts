import { describe, it, expect, vi, beforeEach } from 'vitest'

const query = vi.fn<(...a: any[]) => any>()
const queryOne = vi.fn<(...a: any[]) => any>()
const createAdminNotification = vi.fn<(...a: any[]) => Promise<void>>(async () => {})
const createAutoTask = vi.fn<(...a: any[]) => Promise<void>>(async () => {})
const applyRouteRefundFailed = vi.fn<(...a: any[]) => Promise<void>>(async () => {})

vi.mock('@/lib/shared/db', () => ({ query: (...a: any[]) => query(...a), queryOne: (...a: any[]) => queryOne(...a) }))
vi.mock('@/lib/shared/admin-notify', () => ({ createAdminNotification: (...a: any[]) => createAdminNotification(...a) }))
vi.mock('@/lib/shared/auto-tasks', () => ({ createAutoTask: (...a: any[]) => createAutoTask(...a) }))
vi.mock('@/lib/payments/route-settlement', () => ({ applyRouteRefundFailed: (...a: any[]) => applyRouteRefundFailed(...a) }))
vi.mock('@/lib/payments/webhook-tenant', () => ({ isFlagship: (t: any) => !t?.tenantId || t.tenantId === '00000000-0000-0000-0000-000000000000' }))

import { recordRefund, applyRefundEvent } from '@/lib/payments/refund-records'

const T = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  query.mockResolvedValue({ rows: [], rowCount: 1 })
  queryOne.mockResolvedValue(null)
})

describe('recordRefund', () => {
  it('does nothing without a refund id', async () => {
    await recordRefund({ refund: null })
    await recordRefund({ refund: {} })
    expect(query).not.toHaveBeenCalled()
  })
  it('inserts a processed refund, converting paise to INR and reading the bank ARN', async () => {
    await recordRefund({
      refund: { id: 'rfnd_1', payment_id: 'pay_1', amount: 49900, status: 'processed', speed_requested: 'normal', speed_processed: 'instant', acquirer_data: { arn: 'ARN1' }, notes: { purpose: 'order_adjustment' } },
      paymentRowId: 'p1',
      orderId: 'o1',
    })
    const params = query.mock.calls[0][1]!
    expect(params[0]).toBe('rfnd_1')
    expect(params[1]).toBe('pay_1')
    expect(params[2]).toBe('p1')
    expect(params[3]).toBe('o1')
    expect(params[4]).toBe(499) // 49900 paise -> INR
    expect(params[5]).toBe('processed')
    expect(params[8]).toBe('ARN1') // arn
    expect(params[9]).toBe(JSON.stringify({ arn: 'ARN1' }))
    expect(params[10]).toBe('order_adjustment') // explicit purpose not set -> falls to notes? here opts.purpose undefined, notes.purpose
    expect(params[11]).toBe('app') // default initiatedBy
  })
  it('defaults status to pending when unknown, falls back to rrn then utr for ARN', async () => {
    await recordRefund({ refund: { id: 'rfnd_2', payment_id: 'pay_2', amount: 100, status: 'weird', acquirer_data: { rrn: 'RRN9' } } })
    const params = query.mock.calls[0][1]!
    expect(params[5]).toBe('pending')
    expect(params[8]).toBe('RRN9')
    expect(params[10]).toBeNull() // no purpose, no notes.purpose
  })
  it('honours explicit purpose and initiatedBy/retryOf', async () => {
    await recordRefund({ refund: { id: 'rfnd_3', payment_id: 'pay_3', amount: 0, status: 'failed' }, purpose: 'dispute', initiatedBy: 'retry', retryOf: 'rfnd_0' })
    const params = query.mock.calls[0][1]!
    expect(params[10]).toBe('dispute')
    expect(params[11]).toBe('retry')
    expect(params[12]).toBe('rfnd_0')
  })
})

describe('applyRefundEvent', () => {
  it('returns null when the refund lacks id or payment_id', async () => {
    expect(await applyRefundEvent('refund.processed', {}, null)).toBeNull()
    expect(await applyRefundEvent('refund.processed', { id: 'r' }, null)).toBeNull()
  })

  it('maps refund.failed/processed to the status, linking the local payment', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'p1', order_id: 'o1' }) // local payment lookup
      .mockResolvedValueOnce({ id: 'ref1', order_id: 'o1', status: 'processed', amount: '100', prev_status: 'pending' }) // upsert
    const r = await applyRefundEvent('refund.processed', { id: 'rfnd_1', payment_id: 'pay_1', amount: 10000 }, null)
    expect(r?.status).toBe('processed')
    // 2nd queryOne is the upsert; param index 5 is the status
    const params = queryOne.mock.calls[1][1]!
    expect(params[2]).toBe('p1') // local payment id
    expect(params[3]).toBe('o1')
    expect(params[5]).toBe('processed')
    expect(params[4]).toBe(100) // inr
    expect(applyRouteRefundFailed).not.toHaveBeenCalled()
  })

  it('derives status from statusOf for a non-failed/processed event type', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ref2', order_id: null, status: 'pending', amount: '5', prev_status: null })
    await applyRefundEvent('refund.created', { id: 'rfnd_2', payment_id: 'pay_2', amount: 500, status: 'pending' }, null)
    const params = queryOne.mock.calls[1][1]!
    expect(params[5]).toBe('pending')
    expect(params[2]).toBeNull() // no local payment
    expect(params[11]).toBe('dashboard') // not dispute
  })

  it('marks a dispute-sourced refund as initiated_by dispute', async () => {
    queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'ref3', order_id: null, status: 'processed', amount: '5', prev_status: null })
    await applyRefundEvent('refund.processed', { id: 'rfnd_3', payment_id: 'pay_3', amount: 500, notes: { purpose: 'dispute' } }, null)
    const params = queryOne.mock.calls[1][1]!
    expect(params[11]).toBe('dispute')
  })

  it('on a newly-failed refund: alerts, opens a retry task, and settles the Route share for a tenant store', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'p1', order_id: 'o1' }) // local payment
      .mockResolvedValueOnce({ id: 'ref4', order_id: 'o1', status: 'failed', amount: '250.50', prev_status: 'pending' }) // upsert
      .mockResolvedValueOnce({ order_number: 'ORD-9', user_id: 'u1' }) // order lookup in onRefundFailed
    const r = await applyRefundEvent('refund.failed', { id: 'rfnd_4', payment_id: 'pay_4', amount: 25050, error: { description: 'bank rejected' } }, { tenantId: T, slug: 'acme' })
    expect(r?.status).toBe('failed')
    expect(createAdminNotification).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createAdminNotification).mock.calls[0][0]).toMatchObject({ type: 'refund_failed', severity: 'critical', link: '/admin/orders/o1/view' })
    expect(createAutoTask).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createAutoTask).mock.calls[0][0]).toMatchObject({ userId: 'u1', sourceKind: 'retry_failed_refund', priority: 'urgent' })
    expect(applyRouteRefundFailed).toHaveBeenCalledTimes(1)
    expect(vi.mocked(applyRouteRefundFailed).mock.calls[0][0]).toMatchObject({ tenantId: T, paymentId: 'pay_4', refundId: 'rfnd_4', refundPaise: 25050, orderRef: 'ORD-9' })
    // failure_reason recorded from error.description
    expect(queryOne.mock.calls[1][1]![12]).toBe('bank rejected')
  })

  it('does not re-alert when the refund was already failed', async () => {
    queryOne
      .mockResolvedValueOnce({ id: 'p1', order_id: 'o1' })
      .mockResolvedValueOnce({ id: 'ref5', order_id: 'o1', status: 'failed', amount: '10', prev_status: 'failed' })
    await applyRefundEvent('refund.failed', { id: 'rfnd_5', payment_id: 'pay_5', amount: 1000 }, null)
    expect(createAdminNotification).not.toHaveBeenCalled()
    expect(applyRouteRefundFailed).not.toHaveBeenCalled()
  })

  it('skips the Route settle for the flagship and uses the payment id as label when no order', async () => {
    queryOne
      .mockResolvedValueOnce(null) // no local payment
      .mockResolvedValueOnce({ id: 'ref6', order_id: null, status: 'failed', amount: '10', prev_status: 'pending' })
    // order_id null -> no order lookup, label = payment_id, no auto-task
    await applyRefundEvent('refund.failed', { id: 'rfnd_6', payment_id: 'pay_6', amount: 1000 }, { tenantId: '00000000-0000-0000-0000-000000000000' })
    expect(createAdminNotification).toHaveBeenCalledTimes(1)
    expect(vi.mocked(createAdminNotification).mock.calls[0][0]).toMatchObject({ link: null })
    expect(createAutoTask).not.toHaveBeenCalled()
    expect(applyRouteRefundFailed).not.toHaveBeenCalled() // flagship
  })
})
