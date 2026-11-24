import { describe, it, expect, vi, beforeEach } from 'vitest'

// The billing subscription webhook (lib/billing/webhook.ts). The engine's own modules are mocked at their
// boundaries; SQL is answered by a small router and recorded.

const st = vi.hoisted(() => ({
  calls: [] as { sql: string; params: any[] }[],
  chargeInserted: true,
  tenant: { slug: 'acme', status: 'active', store_request: null as string | null, subscription_status: 'active', plan: 'basic' },
  lines: [] as any[],
  subs: {} as Record<string, any>,
}))
const query = vi.hoisted(() =>
  vi.fn(async (sql: string, params: any[] = []) => {
    st.calls.push({ sql, params })
    if (sql.includes('INSERT INTO billing_charges')) return st.chargeInserted ? { rows: [{ id: 'ch-1' }], rowCount: 1 } : { rows: [], rowCount: 0 }
    if (sql.startsWith('SELECT slug, status, store_request')) return { rows: [st.tenant] }
    if (sql.includes('FROM tenants t LEFT JOIN plans')) return { rows: [{ slug: 'acme', plan: st.tenant.plan }] }
    if (sql.startsWith('SELECT status FROM tenants')) return { rows: [{ status: st.tenant.status }] }
    if (sql.includes('RETURNING *')) return { rows: st.lines.filter(l => l.status === 'awaiting_payment').map(l => ({ ...l, status: 'active' })), rowCount: 1 }
    if (sql.includes('SELECT id FROM billing_subscriptions WHERE tenant_id = $1 AND is_current')) return { rows: [] }
    return { rows: [], rowCount: 1 }
  })
)
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query, connect: async () => ({ query, release: () => {} }) }),
  setSubscriptionStatus: vi.fn(),
  applyPendingPlan: vi.fn().mockResolvedValue(null),
  setPendingPlan: vi.fn(),
  updateTenantPlan: vi.fn(),
}))
vi.mock('@/lib/auth/plan-gate', () => ({ invalidatePlanCache: vi.fn() }))
vi.mock('@/lib/billing/platform-invoice', () => ({ issuePlatformInvoiceLater: vi.fn() }))
vi.mock('@/lib/billing/ad-free', () => ({ AD_FREE_PRICE_INR: 500 }))
vi.mock('@/lib/billing/messaging-addon', () => ({ getMessagingAddonPricing: vi.fn().mockResolvedValue({ priceInr: 500 }) }))
const rz = vi.hoisted(() => ({ cancelSubscription: vi.fn(), refundPayment: vi.fn(), getSubscription: vi.fn() }))
vi.mock('@controller/lib/payments/razorpay-subscriptions', () => rz)
vi.mock('@controller/lib/provisioning/trigger', () => ({ triggerProvisioning: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@controller/lib/provisioning/start-store', () => ({ startStoreIfReady: vi.fn() }))
vi.mock('@controller/lib/compute/store', () => ({ saveDesiredCompute: vi.fn() }))
vi.mock('@controller/lib/domains/renewal', () => ({ markDomainAddonsPaid: vi.fn().mockResolvedValue(0) }))
vi.mock('@controller/lib/showcase/billing', () => ({ notifyShowcaseResumed: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@controller/lib/billing/subscription', () => ({
  subscriptionByRazorpayId: vi.fn(async (id: string) => st.subs[id] ?? null),
  getBillingSubscription: vi.fn(async (id: string) => Object.values(st.subs).find((s: any) => s.id === id) ?? null),
}))
vi.mock('@controller/lib/billing/lines', async () => {
  const actual = await vi.importActual<typeof import('@controller/lib/billing/lines')>('@controller/lib/billing/lines')
  return { ...actual, listLines: vi.fn(async () => st.lines), patchLine: vi.fn() }
})
vi.mock('@controller/lib/billing/entitlements', () => ({ extendEntitlements: vi.fn().mockResolvedValue([]) }))
vi.mock('@controller/lib/billing/migrate', () => ({ applyMigrationCredits: vi.fn().mockResolvedValue(0) }))
vi.mock('@controller/lib/billing/notify', () => ({ notifyBilling: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@controller/lib/billing/sweep', () => ({ closeEndedLines: vi.fn().mockResolvedValue({ ended: 0, stores: 0 }), closeStore: vi.fn() }))

import { onBillingSubscription, refundDue, GRACE_DAYS } from '@controller/lib/billing/webhook'
import { setSubscriptionStatus } from '@/lib/tenant-registry'
import { issuePlatformInvoiceLater } from '@/lib/billing/platform-invoice'
import { startStoreIfReady } from '@controller/lib/provisioning/start-store'
import { patchLine } from '@controller/lib/billing/lines'
import { extendEntitlements } from '@controller/lib/billing/entitlements'
import { applyMigrationCredits } from '@controller/lib/billing/migrate'
import { notifyBilling } from '@controller/lib/billing/notify'
import { closeStore } from '@controller/lib/billing/sweep'
import { notifyShowcaseResumed } from '@controller/lib/showcase/billing'
import { DAY, T, iso, line, sub } from './fixtures'

const nowSec = () => Math.floor(Date.now() / 1000)
const ev = (subId: string, payment?: any, extra: any = {}) => ({
  created_at: nowSec(),
  payload: { subscription: { entity: { id: subId, current_start: nowSec(), current_end: nowSec() + 30 * 86400, ...extra } }, ...(payment ? { payment: { entity: payment } } : {}) },
})
const ctx = { tenantId: T, eventId: 'evt_1' }
const sqls = (frag: string) => st.calls.filter(c => c.sql.includes(frag))

beforeEach(() => {
  vi.clearAllMocks()
  st.calls = []
  st.chargeInserted = true
  st.tenant = { slug: 'acme', status: 'active', store_request: null, subscription_status: 'active', plan: 'basic' }
  st.lines = []
  st.subs = { sub_cur: sub() }
  rz.cancelSubscription.mockResolvedValue({ status: 'cancelled', endsAt: null })
  rz.refundPayment.mockResolvedValue('rfnd_1')
})

describe('routing', () => {
  it('acks and drops an unknown subscription', async () => {
    await expect(onBillingSubscription('subscription.charged', ev('sub_unknown'), ctx)).resolves.toBeUndefined()
    expect(sqls('INSERT INTO billing_charges')).toHaveLength(0)
  })

  it('drops an event whose index tenant does not own the subscription', async () => {
    await onBillingSubscription('subscription.halted', ev('sub_cur'), { tenantId: 'someone-else' })
    expect(st.calls).toHaveLength(0)
  })

  it('does not move the status back on an event older than the last one handled', async () => {
    st.subs.sub_cur = sub({ status: 'active', lastEventAt: iso(Date.now() + DAY) })
    await onBillingSubscription('subscription.pending', ev('sub_cur'), ctx)
    expect(sqls("SET status = $2")).toHaveLength(0)
  })
})

describe('failures', () => {
  it('pending: past due, an update-payment email, the store keeps running (not halted)', async () => {
    st.lines = [line({ kind: 'store_plan' })]
    await onBillingSubscription('subscription.pending', ev('sub_cur', null, { short_url: 'https://rzp.io/i/pay' }), ctx)
    expect(sqls('SET status = $2').some(c => c.params[1] === 'pending')).toBe(true)
    expect(notifyBilling).toHaveBeenCalledWith(T, expect.objectContaining({ kind: 'payment_pending', payUrl: 'https://rzp.io/i/pay' }))
    expect(setSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('halted: a 7-day grace; the store suspends now, sites and add-ons run until the grace ends (decision 7)', async () => {
    const site = line({ kind: 'showcase_site', ref: 's' })
    st.lines = [line({ kind: 'store_plan' }), site]
    await onBillingSubscription('subscription.halted', ev('sub_cur'), ctx)
    const halt = sqls("SET status = 'halted', grace_until = $2")[0]
    expect(Date.parse(halt.params[1]) - Date.now()).toBeGreaterThan((GRACE_DAYS - 1) * DAY)
    expect(setSubscriptionStatus).toHaveBeenCalledWith(T, 'halted', 'suspended')
    expect(vi.mocked(extendEntitlements).mock.calls[0][1].map((l: any) => l.kind)).toEqual(['showcase_site'])
    expect(notifyBilling).toHaveBeenCalledWith(T, expect.objectContaining({ kind: 'halted', store: true }))
  })

  it('halted on a Showcase-only workspace leaves the tenant alone', async () => {
    st.lines = [line({ kind: 'showcase_site', ref: 's' })]
    await onBillingSubscription('subscription.halted', ev('sub_cur'), ctx)
    expect(setSubscriptionStatus).not.toHaveBeenCalled()
  })

  it('resumed: active again, the grace cleared', async () => {
    st.lines = [line({ kind: 'store_plan' })]
    st.tenant.status = 'suspended'
    st.subs.sub_cur = sub({ status: 'halted' })
    await onBillingSubscription('subscription.resumed', ev('sub_cur'), ctx)
    expect(sqls('UPDATE billing_lines SET grace_until = NULL')).toHaveLength(1)
    expect(setSubscriptionStatus).toHaveBeenCalledWith(T, 'active', 'active')
  })
})

describe('subscription.charged', () => {
  const pay = { id: 'pay_1', amount: 349900, invoice_id: 'inv_1' }

  it("a store's first charge starts its lines, extends entitlements, starts the build and invoices", async () => {
    st.tenant = { ...st.tenant, status: 'pending', store_request: null }
    const waiting = line({ status: 'awaiting_payment', subscriptionId: 'bs-cur', legacyRef: 'ad_free:x:2026-12-01' })
    st.lines = [line({ kind: 'store_plan', status: 'awaiting_payment', subscriptionId: 'bs-cur' }), waiting]
    await onBillingSubscription('subscription.charged', ev('sub_cur', pay), ctx)
    expect(sqls('INSERT INTO billing_charges')[0].params).toEqual(expect.arrayContaining([T, 'bs-cur', 'pay_1', 'inv_1', 349900]))
    expect(vi.mocked(patchLine).mock.calls.map(c => c[1])).toEqual([{ status: 'active', grace_until: null }, { status: 'active', grace_until: null }])
    expect(applyMigrationCredits).toHaveBeenCalled()
    expect(extendEntitlements).toHaveBeenCalled()
    expect(startStoreIfReady).toHaveBeenCalledWith(T)
    expect(issuePlatformInvoiceLater).toHaveBeenCalledWith(expect.objectContaining({ externalRef: 'pay_1', amountInr: 3499, pricesIncludeGst: true }))
  })

  it('is idempotent: a payment already recorded does nothing more', async () => {
    st.chargeInserted = false
    st.lines = [line({ kind: 'store_plan' })]
    await onBillingSubscription('subscription.charged', ev('sub_cur', pay), ctx)
    expect(extendEntitlements).not.toHaveBeenCalled()
    expect(issuePlatformInvoiceLater).not.toHaveBeenCalled()
  })

  it('tells the owner a site paused for non-payment is back', async () => {
    st.lines = [line({ kind: 'showcase_site', ref: 'site-1' })]
    vi.mocked(extendEntitlements).mockResolvedValueOnce(['site-1'])
    await onBillingSubscription('subscription.charged', ev('sub_cur', { id: 'pay_2', amount: 20000 }), ctx)
    expect(notifyShowcaseResumed).toHaveBeenCalledWith('site-1')
  })

  it('refunds what a removed line still costs on an unapproved higher mandate (decision 6)', async () => {
    st.subs.sub_cur = sub({ amountPaise: 70000 })
    st.lines = [line({ amountPaise: 50000 })]
    await onBillingSubscription('subscription.charged', ev('sub_cur', { id: 'pay_3', amount: 70000 }), ctx)
    expect(rz.refundPayment).toHaveBeenCalledWith('pay_3', 20000, expect.objectContaining({ reason: 'billing_line_removed' }))
  })

  it('a superseded subscription that charges anyway is refunded in full', async () => {
    st.subs.sub_old = sub({ id: 'bs-old', razorpaySubscriptionId: 'sub_old', status: 'superseded', isCurrent: false })
    await onBillingSubscription('subscription.charged', ev('sub_old', { id: 'pay_4', amount: 50000 }), ctx)
    expect(rz.refundPayment).toHaveBeenCalledWith('pay_4', 50000, expect.objectContaining({ reason: 'billing_superseded' }))
    expect(extendEntitlements).not.toHaveBeenCalled()
  })
})

describe('a replacement taking effect', () => {
  it('on authentication: the old one is superseded and cancelled at cycle end, its new lines start', async () => {
    const oldEnd = iso(Date.now() + 10 * DAY)
    st.subs.sub_cur = sub({ currentEnd: oldEnd })
    st.subs.sub_new = sub({ id: 'bs-new', razorpaySubscriptionId: 'sub_new', status: 'created', isCurrent: false, replacesId: 'bs-cur', upfrontPaise: 12000, startAt: oldEnd })
    st.lines = [line({ kind: 'store_plan' }), line({ status: 'awaiting_payment', subscriptionId: 'bs-new' })]
    await onBillingSubscription('subscription.authenticated', ev('sub_new', { id: 'pay_up', amount: 12000 }), ctx)
    expect(sqls("ELSE 'superseded' END")).toHaveLength(1)
    expect(sqls('SET is_current = true')[0].params).toEqual(['bs-new'])
    // Trials and waiting lines the old one covered move over.
    expect(sqls("SET subscription_id = $2")[0].params).toEqual(['bs-cur', 'bs-new'])
    expect(rz.cancelSubscription).toHaveBeenCalledWith('sub_cur', { cancelAtCycleEnd: true })
    expect(vi.mocked(extendEntitlements).mock.calls[0][2].getTime()).toBe(Date.parse(oldEnd) + DAY)
    // The upfront proration is recorded and invoiced.
    expect(sqls('INSERT INTO billing_charges')[0].params[2]).toBe('pay_up')
    expect(issuePlatformInvoiceLater).toHaveBeenCalledWith(expect.objectContaining({ externalRef: 'pay_up', amountInr: 120 }))
  })

  it('Pay now cancels the halted one at once', async () => {
    st.subs.sub_cur = sub({ status: 'halted' })
    st.subs.sub_new = sub({ id: 'bs-new', razorpaySubscriptionId: 'sub_new', status: 'created', isCurrent: false, replacesId: 'bs-cur', pendingChange: { replaceNow: true } })
    await onBillingSubscription('subscription.authenticated', ev('sub_new'), ctx)
    expect(rz.cancelSubscription).toHaveBeenCalledWith('sub_cur', { cancelAtCycleEnd: false })
  })

  it("a first subscription's authentication mirrors onto the tenant row", async () => {
    st.subs.sub_cur = sub({ status: 'created' })
    await onBillingSubscription('subscription.authenticated', ev('sub_cur'), ctx)
    expect(sqls("SET subscription_status = 'authenticated'")).toHaveLength(1)
    expect(rz.cancelSubscription).not.toHaveBeenCalled()
  })
})

describe('cancelled / completed', () => {
  it('is ignored for a superseded subscription', async () => {
    st.subs.sub_old = sub({ id: 'bs-old', razorpaySubscriptionId: 'sub_old', status: 'superseded', isCurrent: false })
    await onBillingSubscription('subscription.cancelled', ev('sub_old'), ctx)
    expect(sqls('UPDATE billing_lines')).toHaveLength(0)
    expect(closeStore).not.toHaveBeenCalled()
  })

  it('ends the lines; only a store is closed, a Showcase-only workspace stays', async () => {
    st.lines = [line({ kind: 'showcase_site', ref: 's' })]
    await onBillingSubscription('subscription.cancelled', ev('sub_cur', null, { current_end: nowSec() - 60 }), ctx)
    expect(sqls("UPDATE billing_lines SET status = $2")[0].params[1]).toBe('ended')
    expect(closeStore).not.toHaveBeenCalled()

    st.lines = [line({ kind: 'store_plan' })]
    st.subs.sub_cur = sub()
    await onBillingSubscription('subscription.completed', ev('sub_cur', null, { current_end: nowSec() - 60 }), ctx)
    expect(closeStore).toHaveBeenCalledWith(T, 'completed')
  })
})

describe('refundDue', () => {
  const s = { amountPaise: 349900, interval: 'monthly' as const }
  it('is what the subscription charges above what its running lines cost now', () => {
    expect(refundDue(s, [line({ kind: 'store_plan', amountPaise: 299900 }), line({ amountPaise: 50000 })])).toBe(0)
    expect(refundDue(s, [line({ kind: 'store_plan', amountPaise: 299900 })])).toBe(50000)
    // Lines still waiting for a replacement's approval are not on this subscription.
    expect(refundDue(s, [line({ kind: 'store_plan', amountPaise: 299900 }), line({ status: 'awaiting_payment' })])).toBe(50000)
  })

  it('applies a lowered price whose date has come, at the yearly multiple', () => {
    const y = { amountPaise: 2999000, interval: 'yearly' as const }
    const lowered = line({ kind: 'store_plan', amountPaise: 299900, nextAmountPaise: 199900, changesAt: iso(Date.now() - DAY) })
    expect(refundDue(y, [lowered])).toBe(1000000)
  })
})
