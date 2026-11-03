import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), withTransaction: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({
  getFeatureFlags: vi.fn(async () => ({ gstEnabled: true })),
  getBusinessValues: vi.fn(async () => ({ businessStateCode: '33', delhiveryOriginPincode: '600001' })),
}))
vi.mock('@/lib/shipping/edd', () => ({ computeEdd: vi.fn(() => '2026-10-12') }))
vi.mock('@/lib/orders/entitlements', () => ({ grantOrderEntitlements: vi.fn(async () => 1) }))
vi.mock('@/lib/orders/after-commit', () => ({ afterOrderCommitted: vi.fn(async () => {}) }))
vi.mock('@/lib/documents/invoice', () => ({
  createDraftInvoice: vi.fn(async () => {}),
  generateOrderInvoice: vi.fn(async () => null),
}))
vi.mock('@/lib/shared/notify', () => ({ notifyAccessGranted: vi.fn(async () => {}) }))
vi.mock('@/lib/payments/razorpay-route', () => ({
  transferToLinkedAccount: vi.fn(),
  recordTenantTransaction: vi.fn(async () => {}),
}))
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query: vi.fn() }) }))
vi.mock('@/lib/email/subscription', () => ({
  sendSubscriptionStartedEmail: vi.fn(async () => {}),
  sendSubscriptionPaymentFailedEmail: vi.fn(async () => {}),
  sendSubscriptionCancelledEmail: vi.fn(async () => {}),
}))

import { queryOne, withTransaction } from '@/lib/shared/db'
import { grantOrderEntitlements } from '@/lib/orders/entitlements'
import { afterOrderCommitted } from '@/lib/orders/after-commit'
import {
  sendSubscriptionStartedEmail,
  sendSubscriptionPaymentFailedEmail,
  sendSubscriptionCancelledEmail,
} from '@/lib/email/subscription'
import {
  ACCESS_GRACE_MS,
  applySubscriptionState,
  commitCycle,
  nextStatus,
  processSubscriptionEvent,
  statusForEvent,
} from '@/lib/subscriptions/cycle'

function subRow(o: Record<string, unknown> = {}) {
  return {
    id: 'L1',
    user_id: 'u1',
    product_id: 'p1',
    variant_id: null,
    sub_variant_id: null,
    status: 'active',
    quantity: '2',
    unit_price_paise: 45000,
    shipping_paise: 6000,
    gst_rate: '18',
    hsn_code: '0901',
    is_digital: false,
    address_id: 'a1',
    address_snapshot: { full_name: 'A', state: 'Tamil Nadu', postal_code: '600001' },
    collecting_account: 'platform',
    linked_account_id: null,
    razorpay_subscription_id: 'sub_1',
    current_cycle: 0,
    current_start: null,
    current_end: null,
    ...o,
  }
}

type Handler = (sql: string, params: any[]) => any

/** A fake pg client that answers by SQL text; records every statement. */
function fakeClient(over: Record<string, Handler> = {}, sub = subRow()) {
  const calls: Array<{ sql: string; params: any[] }> = []
  const defaults: Record<string, Handler> = {
    'FROM subscriptions WHERE id = $1 FOR UPDATE': () => ({ rows: [sub] }),
    'WHERE sco.razorpay_payment_id': () => ({ rows: [] }),
    'MAX(cycle_number)': () => ({ rows: [{ max: null }] }),
    'INSERT INTO subscription_cycle_orders': () => ({ rows: [{ id: 'led1' }] }),
    'FROM users': () => ({ rows: [{ id: 'u1', email: 'u@e.com', first_name: 'A', last_name: 'B' }] }),
    'FROM products p': () => ({ rows: [{ name: 'Coffee', sku: 'C1', mrp: 500 }] }),
    'INSERT INTO orders': (_s, p) => ({ rows: [{ id: 'o1', order_number: 'ORD-1', total_amount: '960', status: p[5] }] }),
    'status = $2::text': (_s, p) => ({ rows: [{ ...sub, status: p[1] }] }),
  }
  const handlers = { ...defaults, ...over }
  const client = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      calls.push({ sql, params })
      for (const [k, h] of Object.entries(handlers)) if (sql.includes(k)) return h(sql, params)
      return { rows: [], rowCount: 1 }
    }),
  }
  vi.mocked(withTransaction).mockImplementation(async (fn: any) => fn(client))
  return { client, calls, has: (frag: string) => calls.some(c => c.sql.includes(frag)) }
}

const end = new Date('2026-11-07T00:00:00Z')
const base = { subscriptionId: 'L1', paymentId: 'pay_1', amountPaise: 96000, paidCount: 1, currentEnd: end }

describe('commitCycle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('physical cycle: one confirmed order from the snapshot, no grant', async () => {
    const f = fakeClient()
    const r = await commitCycle(base)
    expect(r).toEqual({ created: true, orderId: 'o1', orderNumber: 'ORD-1', cycle: 1 })
    const order = f.calls.find(c => c.sql.includes('INSERT INTO orders'))!
    expect(order.params[5]).toBe('confirmed')
    expect(order.params[9]).toBe(960) // 450 × 2 + 60 shipping
    expect(order.params[17]).toBe(JSON.stringify(subRow().address_snapshot))
    expect(order.params[19]).toBe('L1')
    expect(order.params[20]).toBe(1)
    expect(grantOrderEntitlements).not.toHaveBeenCalled()
    expect(afterOrderCommitted).toHaveBeenCalledOnce()
    expect(sendSubscriptionStartedEmail).toHaveBeenCalledWith('L1')
  })

  it('duplicate payment id already in the ledger → no second order', async () => {
    const f = fakeClient({
      'WHERE sco.razorpay_payment_id': () => ({ rows: [{ order_id: 'o1', cycle_number: 1, order_number: 'ORD-1' }] }),
    })
    const r = await commitCycle(base)
    expect(r).toEqual({ created: false, orderId: 'o1', orderNumber: 'ORD-1', cycle: 1 })
    expect(f.has('INSERT INTO orders')).toBe(false)
    expect(f.has('INSERT INTO subscription_cycle_orders')).toBe(false)
    expect(afterOrderCommitted).not.toHaveBeenCalled()
  })

  it('ON CONFLICT (razorpay_payment_id) losing the race → no order insert', async () => {
    const f = fakeClient({ 'INSERT INTO subscription_cycle_orders': () => ({ rows: [] }) })
    const r = await commitCycle(base)
    expect(r.created).toBe(false)
    const ledger = f.calls.find(c => c.sql.includes('INSERT INTO subscription_cycle_orders'))!
    expect(ledger.sql).toContain('ON CONFLICT (razorpay_payment_id) DO NOTHING')
    expect(f.has('INSERT INTO orders')).toBe(false)
  })

  it('digital cycle: granted order + subscription grant expiring at current_end + 3 days', async () => {
    const f = fakeClient({}, subRow({ is_digital: true, quantity: '1', shipping_paise: 0 }))
    await commitCycle(base)
    const order = f.calls.find(c => c.sql.includes('INSERT INTO orders'))!
    expect(order.params[5]).toBe('granted')
    expect(order.params[21]).toBe(true)
    expect(grantOrderEntitlements).toHaveBeenCalledWith(expect.anything(), {
      orderId: 'o1',
      userId: 'u1',
      source: 'subscription',
      subscriptionId: 'L1',
      accessExpiresAt: new Date(end.getTime() + ACCESS_GRACE_MS),
    })
  })

  it('a taken cycle number falls forward instead of failing the paid cycle', async () => {
    const f = fakeClient({ 'MAX(cycle_number)': () => ({ rows: [{ max: 3 }] }) })
    const r = await commitCycle({ ...base, paidCount: 2 })
    expect(r.cycle).toBe(4)
    expect(f.calls.find(c => c.sql.includes('INSERT INTO subscription_cycle_orders'))!.params[1]).toBe(4)
  })
})

describe('nextStatus / statusForEvent', () => {
  it('maps events to statuses', () => {
    expect(statusForEvent('subscription.charged')).toBe('active')
    expect(statusForEvent('subscription.halted')).toBe('halted')
    expect(statusForEvent('subscription.updated')).toBeNull()
  })

  it('walks the normal lifecycle', () => {
    expect(nextStatus('created', 'authenticated')).toBe('authenticated')
    expect(nextStatus('authenticated', 'active')).toBe('active')
    expect(nextStatus('active', 'pending')).toBe('pending')
    expect(nextStatus('pending', 'halted')).toBe('halted')
    expect(nextStatus('halted', 'active')).toBe('active')
    expect(nextStatus('active', 'paused')).toBe('paused')
    expect(nextStatus('paused', 'active')).toBe('active')
    expect(nextStatus('active', 'cancelled')).toBe('cancelled')
    expect(nextStatus('active', 'completed')).toBe('completed')
  })

  it('never resurrects a cancelled/completed sub and ignores a late authenticated', () => {
    expect(nextStatus('cancelled', 'active')).toBe('cancelled')
    expect(nextStatus('completed', 'active')).toBe('completed')
    expect(nextStatus('cancelled', 'halted')).toBe('cancelled')
    expect(nextStatus('active', 'authenticated')).toBe('active')
    expect(nextStatus('active', null)).toBe('active')
  })
})

describe('applySubscriptionState', () => {
  beforeEach(() => vi.clearAllMocks())

  it('halted: caps access at current_end and sends the payment-failed email', async () => {
    const f = fakeClient({}, subRow({ status: 'active', current_end: end }))
    const r = await applySubscriptionState('L1', 'halted', { current_end: end.getTime() / 1000 })
    expect(r.changed).toBe(true)
    const upd = f.calls.find(c => c.sql.includes('status = $2::text'))!
    expect(upd.params[1]).toBe('halted')
    expect(upd.params[5]).toBe(true) // cap access_expires_at
    expect(f.has('UPDATE vault_entitlements')).toBe(true)
    expect(sendSubscriptionPaymentFailedEmail).toHaveBeenCalledWith('L1')
  })

  it('cancelled sub stays cancelled on a late charged event; no email, no cap', async () => {
    const f = fakeClient({}, subRow({ status: 'cancelled' }))
    const r = await applySubscriptionState('L1', 'active', {})
    expect(r.changed).toBe(false)
    expect(f.calls.find(c => c.sql.includes('status = $2::text'))!.params[1]).toBe('cancelled')
    expect(f.has('UPDATE vault_entitlements')).toBe(false)
    expect(sendSubscriptionCancelledEmail).not.toHaveBeenCalled()
  })

  it('cancelled transition sends the cancelled email', async () => {
    fakeClient({}, subRow({ status: 'active', current_end: end }))
    await applySubscriptionState('L1', 'cancelled', {})
    expect(sendSubscriptionCancelledEmail).toHaveBeenCalledWith('L1')
  })

  it('period dates never move backwards', async () => {
    const f = fakeClient({}, subRow({ current_end: end }))
    await applySubscriptionState('L1', 'active', { current_end: end.getTime() / 1000 - 86400 })
    const upd = f.calls.find(c => c.sql.includes('status = $2::text'))!
    expect((upd.params[3] as Date).getTime()).toBe(end.getTime())
  })
})

describe('processSubscriptionEvent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('acks an unknown subscription without writing', async () => {
    vi.mocked(queryOne).mockResolvedValue(null)
    const ok = await processSubscriptionEvent('subscription.charged', { payload: { subscription: { entity: { id: 'sub_x' } } } }, null)
    expect(ok).toBe(false)
    expect(withTransaction).not.toHaveBeenCalled()
  })

  it('charged: commits the cycle from paid_count then applies state', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: 'L1' })
    const f = fakeClient()
    const ok = await processSubscriptionEvent(
      'subscription.charged',
      {
        payload: {
          subscription: { entity: { id: 'sub_1', paid_count: 2, current_end: end.getTime() / 1000 } },
          payment: { entity: { id: 'pay_2', status: 'captured', amount: 96000 } },
        },
      },
      { tenantId: 't1', slug: 'acme' }
    )
    expect(ok).toBe(true)
    expect(f.calls.find(c => c.sql.includes('INSERT INTO subscription_cycle_orders'))!.params.slice(1, 3)).toEqual([2, 'pay_2'])
    expect(f.has('status = $2::text')).toBe(true)
  })
})
