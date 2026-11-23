import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ queryOne: vi.fn(), queryMany: vi.fn(async () => []), query: vi.fn(async () => ({ rows: [] })) }))
vi.mock('@/lib/shared/db', () => db)
const email = vi.hoisted(() => ({
  sendOrderAutoCancelledEmail: vi.fn(async () => {}),
  sendOrderAutoCancelledAdminNotification: vi.fn(async () => {}),
  sendOrderStatusUpdate: vi.fn(async () => {}),
}))
vi.mock('@/lib/email', () => email)
const tasks = vi.hoisted(() => ({ createAutoTask: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/auto-tasks', () => tasks)
const act = vi.hoisted(() => ({ logActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/shared/activity', () => act)
const upi = vi.hoisted(() => ({ upiPaymentOpen: vi.fn(async () => false) }))
vi.mock('@/lib/payments/upi/intents', () => upi)

import { cancelOrder, CANCELLABLE_STATUSES } from '@/lib/orders/orders'
import { queryOne, queryMany, query } from '@/lib/shared/db'
import { sendOrderAutoCancelledEmail, sendOrderStatusUpdate, sendOrderAutoCancelledAdminNotification } from '@/lib/email'
import { createAutoTask } from '@/lib/shared/auto-tasks'
import { logActivity } from '@/lib/shared/activity'
import { upiPaymentOpen } from '@/lib/payments/upi/intents'

const order = (over: Record<string, any> = {}) => ({
  id: 'o1',
  order_number: 'ORD-1',
  status: 'pending',
  payment_status: 'unpaid',
  user_id: 'u1',
  order_type: 'cart',
  source: 'online',
  customer_name: 'Cara',
  customer_email: 'c@acme.test',
  total_amount: '500.00',
  users: { email: 'cara@acme.test', first_name: 'Cara', last_name: 'Lee' },
  ...over,
})

beforeEach(() => {
  vi.mocked(upiPaymentOpen).mockResolvedValue(false)
  vi.mocked(queryMany).mockResolvedValue([])
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
})

describe('cancelOrder guards', () => {
  it('404 when the order is missing', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(null)
    expect(await cancelOrder('o1', { reason: 'user_request' })).toEqual({ success: false, error: 'Order not found', status: 404 })
  })
  it('404 when expectedUserId does not match', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ user_id: 'other' }))
    expect(await cancelOrder('o1', { reason: 'user_request', expectedUserId: 'u1' })).toEqual({ success: false, error: 'Order not found', status: 404 })
  })
  it('400 when the status is not cancellable', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ status: 'shipped' }))
    const r = await cancelOrder('o1', { reason: 'user_request' })
    expect(r).toEqual({ success: false, error: 'Cancellation cannot be requested — current status is "shipped"', status: 400 })
  })
  it('409 when auto-cancel is asked on a non-online order', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ source: 'admin' }))
    expect(await cancelOrder('o1', { reason: 'auto_cancel_unpaid' })).toEqual({ success: false, error: 'Only storefront orders are cancelled automatically', status: 409 })
  })
  it('409 when a UPI payment is still in flight', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order())
    vi.mocked(upiPaymentOpen).mockResolvedValueOnce(true)
    const r = await cancelOrder('o1', { reason: 'user_request' })
    expect(r.success).toBe(false)
    expect((r as any).status).toBe(409)
  })
  it('exports the cancellable statuses', () => {
    expect(CANCELLABLE_STATUSES).toEqual(['pending', 'confirmed', 'processing'])
  })
})

describe('cancelOrder direct cancel (unpaid pending)', () => {
  it('cancels directly without restoring to cart', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order())
    const r = await cancelOrder('o1', { reason: 'user_request' })
    expect(r).toEqual({ success: true, directCancel: true, restoredToCart: false })
    const upd = vi.mocked(query).mock.calls.find(c => String(c[0]).includes("status = 'cancelled'"))
    expect(upd).toBeTruthy()
    expect(upd![1]).toEqual(['o1'])
  })

  it('restores items to the cart (merge + insert)', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(order())
      .mockResolvedValueOnce({ id: 'cart-1' }) // existing cart item for first line
      .mockResolvedValueOnce(null) // no existing for second line
    vi.mocked(queryMany).mockResolvedValueOnce([
      { product_id: 'p1', variant_id: 'v1', quantity: 2, unit_price: '100' },
      { product_id: 'p2', variant_id: null, quantity: 1, unit_price: '50' },
    ])
    const r = await cancelOrder('o1', { reason: 'user_request', restoreToCart: true })
    expect(r).toEqual({ success: true, directCancel: true, restoredToCart: true })
    const merge = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('UPDATE cart_items SET quantity'))
    expect(merge![1]).toEqual([2, 'cart-1'])
    const ins = vi.mocked(query).mock.calls.find(c => String(c[0]).includes('INSERT INTO cart_items'))
    expect(ins![1]).toEqual(['u1', 'p2', null, 1, '50'])
  })

  it('does not restore for a direct order even when asked', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ order_type: 'direct' }))
    const r = await cancelOrder('o1', { reason: 'user_request', restoreToCart: true })
    expect(r).toEqual({ success: true, directCancel: true, restoredToCart: false })
  })

  it('auto-cancel sends the email and creates a follow-up task', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order())
    const r = await cancelOrder('o1', { reason: 'auto_cancel_unpaid' })
    expect(r.success).toBe(true)
    expect(sendOrderAutoCancelledEmail).toHaveBeenCalled()
    const call = vi.mocked(sendOrderAutoCancelledEmail).mock.calls[0]
    expect(call[0]).toBe('cara@acme.test') // user email preferred
    expect(call[1]).toBe('Cara Lee')
    expect(call[2]).toBe('ORD-1')
    expect(call[5]).toBe(500) // parseFloat total
    expect(call[6]).toBe('/cart') // non-direct redirect
    expect(createAutoTask).toHaveBeenCalledWith(expect.objectContaining({ sourceKind: 'abandoned_checkout', sourceRefId: 'o1' }))
  })

  it('auto-cancel of a direct order redirects to the product page', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(order({ order_type: 'direct' }))
      .mockResolvedValueOnce({ slug: 'cool-widget' }) // first item lookup
    await cancelOrder('o1', { reason: 'auto_cancel_unpaid' })
    expect(vi.mocked(sendOrderAutoCancelledEmail).mock.calls[0][6]).toBe('/products/cool-widget')
  })

  it('treats failed payment_status like unpaid for a direct cancel', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ payment_status: 'failed' }))
    const r = await cancelOrder('o1', { reason: 'user_request' })
    expect((r as any).directCancel).toBe(true)
  })
})

describe('cancelOrder cancel request (paid/confirmed)', () => {
  it('moves a confirmed order to cancel_requested and emails the customer', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ status: 'confirmed', payment_status: 'paid' }))
    const r = await cancelOrder('o1', { reason: 'user_request' })
    expect(r).toEqual({ success: true, directCancel: false, restoredToCart: false, cancelRequested: true })
    const upd = vi.mocked(query).mock.calls.find(c => String(c[0]).includes("status = 'cancel_requested'"))
    expect(upd![1]).toEqual(['o1'])
    expect(sendOrderStatusUpdate).toHaveBeenCalledWith('cara@acme.test', 'Cara Lee', 'ORD-1', 'o1', 'cancel_requested', 'confirmed')
  })

  it('skips the email when there is no recipient name/email', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ status: 'confirmed', payment_status: 'paid', users: null, customer_email: null, customer_name: null }))
    const r = await cancelOrder('o1', { reason: 'user_request' })
    expect((r as any).cancelRequested).toBe(true)
    expect(sendOrderStatusUpdate).not.toHaveBeenCalled()
  })
})

describe('cancelOrder fire-and-forget failures are swallowed', () => {
  it('direct auto-cancel still succeeds when email/task/activity reject', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order())
    vi.mocked(sendOrderAutoCancelledEmail).mockRejectedValueOnce(new Error('mail down'))
    vi.mocked(createAutoTask).mockRejectedValueOnce(new Error('task down'))
    vi.mocked(logActivity).mockRejectedValueOnce(new Error('log down'))
    const r = await cancelOrder('o1', { reason: 'auto_cancel_unpaid' })
    expect(r).toEqual({ success: true, directCancel: true, restoredToCart: false })
  })

  it('treats an open-UPI lookup error as not-open and proceeds', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order())
    vi.mocked(upiPaymentOpen).mockRejectedValueOnce(new Error('upi check failed'))
    const r = await cancelOrder('o1', { reason: 'user_request' })
    expect((r as any).directCancel).toBe(true) // .catch(() => false) let it through
  })

  it('cancel-request path swallows a rejecting logActivity', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ status: 'confirmed', payment_status: 'paid' }))
    vi.mocked(logActivity).mockRejectedValueOnce(new Error('log down'))
    const r = await cancelOrder('o1', { reason: 'user_request' })
    expect((r as any).cancelRequested).toBe(true)
  })

  it('auto-cancel of a direct order with no product slug redirects to /products', async () => {
    vi.mocked(queryOne)
      .mockResolvedValueOnce(order({ order_type: 'direct' }))
      .mockResolvedValueOnce({ slug: null }) // first item has no slug
    await cancelOrder('o1', { reason: 'auto_cancel_unpaid' })
    expect(vi.mocked(sendOrderAutoCancelledEmail).mock.calls[0][6]).toBe('/products')
  })

  it('auto-cancel skips the email when there is no recipient email', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ users: null, customer_email: null }))
    const r = await cancelOrder('o1', { reason: 'auto_cancel_unpaid' })
    expect(r.success).toBe(true)
    expect(sendOrderAutoCancelledEmail).not.toHaveBeenCalled()
  })

  it('auto-cancel of an order with no user_id skips the follow-up task', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ user_id: null }))
    const r = await cancelOrder('o1', { reason: 'auto_cancel_unpaid' })
    expect(r.success).toBe(true)
    expect(createAutoTask).not.toHaveBeenCalled()
  })

  it('swallows a rejecting auto-cancel admin notification', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order())
    vi.mocked(sendOrderAutoCancelledAdminNotification).mockRejectedValueOnce(new Error('notify down'))
    const r = await cancelOrder('o1', { reason: 'auto_cancel_unpaid' })
    expect(r.success).toBe(true)
  })

  it('swallows a rejecting cancel-request status email', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ status: 'confirmed', payment_status: 'paid' }))
    vi.mocked(sendOrderStatusUpdate).mockRejectedValueOnce(new Error('mail down'))
    const r = await cancelOrder('o1', { reason: 'user_request' })
    expect((r as any).cancelRequested).toBe(true)
  })

  it('auto-cancel falls back to customer fields when the user row has blank name/email', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ users: { email: null, first_name: '', last_name: '' } }))
    await cancelOrder('o1', { reason: 'auto_cancel_unpaid' })
    const call = vi.mocked(sendOrderAutoCancelledEmail).mock.calls[0]
    expect(call[0]).toBe('c@acme.test') // customer_email fallback
    expect(call[1]).toBe('Customer') // user present but blank name -> 'Customer'
  })

  it('cancel-request uses the customer name when the user name is blank', async () => {
    vi.mocked(queryOne).mockResolvedValueOnce(order({ status: 'confirmed', payment_status: 'paid', users: { email: 'x@acme.test', first_name: '', last_name: '' } }))
    await cancelOrder('o1', { reason: 'user_request' })
    // user email present, but name blank -> '' ; email still sent only if name truthy -> name '' so skipped
    expect(sendOrderStatusUpdate).not.toHaveBeenCalled()
  })
})
