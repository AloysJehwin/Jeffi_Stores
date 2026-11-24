import { describe, it, expect, vi, beforeEach } from 'vitest'

const db = vi.hoisted(() => ({ lines: [] as any[], current: null as any, failInsert: false, calls: [] as { sql: string; params: any[] }[] }))
const query = vi.hoisted(() =>
  vi.fn(async (sql: string, params: any[] = []) => {
    db.calls.push({ sql, params })
    if (db.failInsert && sql.includes('INSERT INTO billing_subscriptions')) throw new Error('db down')
    if (/FROM billing_lines WHERE tenant_id = \$1/.test(sql) && sql.startsWith('SELECT')) return { rows: db.lines }
    if (/FROM billing_subscriptions WHERE tenant_id = \$1 AND is_current/.test(sql)) return { rows: db.current ? [db.current] : [] }
    if (sql.includes('uuid_generate_v4() AS id')) return { rows: [{ id: 'bs-new' }] }
    if (sql.startsWith('SELECT slug FROM tenants')) return { rows: [{ slug: 'acme' }] }
    if (sql.includes('INSERT INTO billing_lines')) return { rows: [{ id: 'l-new', tenant_id: params[0], kind: params[1], ref: params[2], amount_paise: params[3], status: params[4], created_at: new Date().toISOString() }] }
    if (sql.startsWith('UPDATE billing_subscriptions SET status = \'abandoned\'')) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 0 }
  })
)
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query, connect: async () => ({ query, release: () => {} }) }),
}))
vi.mock('@/lib/billing/ad-free', () => ({ AD_FREE_PRICE_INR: 500 }))
vi.mock('@/lib/billing/messaging-addon', () => ({ getMessagingAddonPricing: vi.fn().mockResolvedValue({ priceInr: 500 }), invalidateMessagingEntitlement: vi.fn() }))
const rz = vi.hoisted(() => ({
  createBillingSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
  getSubscription: vi.fn(),
}))
vi.mock('@controller/lib/payments/razorpay-subscriptions', () => ({ ...rz, razorpayMode: () => 'test' }))

import { applyChange, planChange, isPaying } from '@controller/lib/billing/subscription'
import { DAY, NOW, T, iso, line, sub } from './fixtures'

const store = (o = {}) => line({ kind: 'store_plan', amountPaise: 299900, ...o })
const site = (ref: string, o = {}) => line({ kind: 'showcase_site', ref, amountPaise: 20000, ...o })
const trial = (ref: string, days: number, o = {}) => site(ref, { status: 'trial', trialEndsAt: iso(NOW + days * DAY), ...o })

describe('planChange: first subscriptions', () => {
  it('starts autopay for a trial site when its trial ends, charging for it (decision 1)', () => {
    const t = trial('a', 4)
    const p = planChange(T, [t], null, { add: [{ kind: 'showcase_site', ref: 'a', amountPaise: 20000 }] }, NOW)
    expect(p.kind).toBe('new')
    expect(p.covered.map(l => l.id)).toEqual([t.id])
    expect(p.cyclePaise).toBe(20000)
    expect(p.startAt).toBe(NOW + 4 * DAY)
    expect(p.upfrontPaise).toBe(0)
  })

  it('charges every chosen trial from the earliest trial end', () => {
    const a = trial('a', 3)
    const b = trial('b', 6)
    const p = planChange(T, [a, b], null, { add: [{ kind: 'showcase_site', ref: 'a' }, { kind: 'showcase_site', ref: 'b' }] }, NOW)
    expect(p.cyclePaise).toBe(40000)
    expect(p.startAt).toBe(NOW + 3 * DAY)
  })

  it('does not bill a trial the owner did not choose', () => {
    const p = planChange(T, [trial('a', 3)], null, { add: [{ kind: 'ad_free', amountPaise: 50000 }] }, NOW)
    expect(p.kind).toBe('new')
    expect(p.cyclePaise).toBe(50000)
    expect(p.startAt).toBeNull()
  })

  it('starts a store at checkout with its add-ons, yearly at ten months', () => {
    const p = planChange(T, [], null, { add: [{ kind: 'store_plan', amountPaise: 299900 }, { kind: 'ad_free', amountPaise: 50000 }], interval: 'yearly', immediate: true }, NOW)
    expect(p.kind).toBe('new')
    expect(p.cyclePaise).toBe((299900 + 50000) * 10)
    expect(p.startAt).toBeNull()
    expect(p.methods).toEqual(['card', 'emandate'])
  })

  it('brings wallet-paid lines onto a subscription that starts now (the migration)', () => {
    const legacy = line({ status: 'legacy_wallet', legacyRef: 'ad_free:x:2026-12-01' })
    const p = planChange(T, [legacy, site('a', { status: 'legacy_wallet' })], null, { migrate: true, immediate: true }, NOW)
    expect(p.kind).toBe('new')
    expect(p.migrated).toHaveLength(2)
    expect(p.cyclePaise).toBe(70000)
    expect(p.startAt).toBeNull()
  })

  it('Pay now on a halted subscription replaces it at once', () => {
    const halted = sub({ status: 'halted', amountPaise: 50000 })
    const p = planChange(T, [line({ graceUntil: iso(NOW + 3 * DAY) })], halted, { immediate: true }, NOW)
    expect(p.kind).toBe('new')
    expect(p.replaceNow).toBe(true)
    expect(p.startAt).toBeNull()
    expect(p.cyclePaise).toBe(50000)
  })

  it('changes nothing when there is nothing to charge', () => {
    expect(planChange(T, [], null, {}, NOW).kind).toBe('unchanged')
  })
})

describe('planChange: changes to a paying subscription', () => {
  const cur = sub({ amountPaise: 299900 })

  it('an add-on is an increase: a replacement at cycle end plus the rest of this cycle upfront', () => {
    const p = planChange(T, [store()], cur, { add: [{ kind: 'ad_free', amountPaise: 50000 }] }, NOW)
    expect(p.kind).toBe('increase')
    expect(p.cyclePaise).toBe(349900)
    expect(p.upfrontPaise).toBe(25000)
    expect(p.startAt).toBe(NOW + 15 * DAY)
  })

  it('removing a paid line is a decrease at cycle end, with no refund now', () => {
    const cur2 = sub({ amountPaise: 349900 })
    const p = planChange(T, [store(), line()], cur2, { remove: [{ kind: 'ad_free' }] }, NOW)
    expect(p.kind).toBe('decrease')
    expect(p.removed[0]).toMatchObject({ status: 'ending', endsAt: iso(NOW + 15 * DAY) })
    expect(p.cyclePaise).toBe(299900)
    expect(p.upfrontPaise).toBe(0)
    expect(p.startAt).toBe(NOW + 15 * DAY)
  })

  it('removing the only line cancels at cycle end', () => {
    const p = planChange(T, [line()], sub(), { remove: [{ kind: 'ad_free' }] }, NOW)
    expect(p.kind).toBe('cancel')
  })

  it('a store downgrade lowers the plan price from cycle end', () => {
    const p = planChange(T, [store()], cur, { amounts: [{ kind: 'store_plan', amountPaise: 199900 }] }, NOW)
    expect(p.kind).toBe('decrease')
    expect(p.lowered[0].amountPaise).toBe(199900)
    expect(p.after[0]).toMatchObject({ amountPaise: 299900, nextAmountPaise: 199900, changesAt: iso(NOW + 15 * DAY) })
    expect(p.cyclePaise).toBe(199900)
  })

  it('a store upgrade raises the price once authorised, with the difference upfront', () => {
    const p = planChange(T, [store()], cur, { amounts: [{ kind: 'store_plan', amountPaise: 499900 }] }, NOW)
    expect(p.kind).toBe('increase')
    expect(p.raised[0].amountPaise).toBe(499900)
    expect(p.upfrontPaise).toBe(100000)
  })

  it('monthly to yearly is an increase even at the same price', () => {
    const p = planChange(T, [store()], cur, { interval: 'yearly' }, NOW)
    expect(p.kind).toBe('increase')
    expect(p.cyclePaise).toBe(2999000)
  })

  it('a store gets its first site free: it starts at once, nothing to approve (decision 9)', () => {
    const t = trial('a', 4)
    const p = planChange(T, [store(), t], cur, { add: [{ kind: 'showcase_site', ref: 'a' }] }, NOW)
    expect(p.kind).toBe('unchanged')
    expect(p.free.map(l => l.id)).toEqual([t.id])
  })

  it('a second site on a store is charged from its trial end', () => {
    const first = site('a', { subscriptionId: 'bs-cur' })
    const t = trial('b', 5)
    const p = planChange(T, [store(), first, t], cur, { add: [{ kind: 'showcase_site', ref: 'b' }] }, NOW)
    expect(p.kind).toBe('increase')
    expect(p.cyclePaise).toBe(299900 + 20000)
    // 10 of the 30 days left after the trial.
    expect(p.upfrontPaise).toBe(Math.round((20000 * 10) / 30))
  })

  it('a trial ending after the cycle end is charged from the next cycle, nothing upfront', () => {
    const t = trial('a', 20)
    const p = planChange(T, [line(), t], sub(), { add: [{ kind: 'showcase_site', ref: 'a' }] }, NOW)
    expect(p.kind).toBe('increase')
    expect(p.upfrontPaise).toBe(0)
    expect(p.cyclePaise).toBe(70000)
  })

  it('closing a store keeps its included site free until the plan ends, then charges it', () => {
    const p = planChange(T, [store(), site('a')], cur, { remove: [{ kind: 'store_plan' }] }, NOW)
    expect(p.kind).toBe('decrease')
    expect(p.cyclePaise).toBe(20000)
    expect(p.upfrontPaise).toBe(0)
  })

  it('a running trial taken off the bill goes back to waiting (it pauses at its end)', () => {
    const t = trial('a', 4, { subscriptionId: 'bs-cur' })
    const p = planChange(T, [line(), t], sub({ amountPaise: 70000 }), { remove: [{ kind: 'showcase_site', ref: 'a' }] }, NOW)
    expect(p.removed[0]).toMatchObject({ status: 'trial', subscriptionId: null })
    expect(p.kind).toBe('decrease')
  })

  it('keeps the lines of an earlier replacement still waiting for approval', () => {
    const waiting = line({ status: 'awaiting_payment', subscriptionId: 'bs-pending' })
    const p = planChange(T, [store(), waiting], cur, { add: [{ kind: 'messaging_addon', ref: 'both', amountPaise: 50000 }] }, NOW)
    expect(p.cyclePaise).toBe(299900 + 50000 + 50000)
    expect(p.upfrontPaise).toBe(50000)
  })

  it('an authorised subscription not charged yet ends its cycle at its start date', () => {
    const authorised = sub({ status: 'authenticated', currentStart: null, currentEnd: null, startAt: iso(NOW + 3 * DAY), amountPaise: 20000 })
    const p = planChange(T, [trial('a', 3, { subscriptionId: 'bs-cur' })], authorised, { add: [{ kind: 'ad_free', amountPaise: 50000 }] }, NOW)
    expect(p.kind).toBe('increase')
    expect(p.startAt).toBe(NOW + 3 * DAY)
    expect(p.upfrontPaise).toBe(5000)
  })
})

describe('isPaying', () => {
  it('is true for authenticated, active and pending subscriptions only', () => {
    expect(isPaying(sub({ status: 'authenticated' }))).toBe(true)
    expect(isPaying(sub({ status: 'pending' }))).toBe(true)
    expect(isPaying(sub({ status: 'created' }))).toBe(false)
    expect(isPaying(sub({ status: 'halted' }))).toBe(false)
    expect(isPaying(null)).toBe(false)
  })
})

const row = (l: any) => ({
  id: l.id, tenant_id: l.tenantId, kind: l.kind, ref: l.ref, amount_paise: l.amountPaise, status: l.status, subscription_id: l.subscriptionId,
  next_amount_paise: l.nextAmountPaise, changes_at: l.changesAt, trial_ends_at: l.trialEndsAt, ends_at: l.endsAt, grace_until: l.graceUntil,
  legacy_ref: l.legacyRef, last_notice: l.lastNotice, created_at: l.createdAt,
})
const subRow = (s: any) => ({
  id: s.id, tenant_id: s.tenantId, razorpay_subscription_id: s.razorpaySubscriptionId, status: s.status, is_current: s.isCurrent,
  billing_interval: s.interval, amount_paise: s.amountPaise, upfront_paise: s.upfrontPaise, lines: s.lines, current_start: s.currentStart,
  current_end: s.currentEnd, start_at: s.startAt, created_at: s.createdAt,
})

describe('applyChange', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.calls = []
    db.lines = []
    db.current = null
    db.failInsert = false
    rz.createBillingSubscription.mockResolvedValue({ subscriptionId: 'sub_new', shortUrl: 'https://rzp.io/i/new', planId: 'plan_x' })
    rz.cancelSubscription.mockResolvedValue({ status: 'cancelled', endsAt: null })
  })

  it('an increase creates a replacement that is not current yet and cancels nothing (section 1 bug)', async () => {
    db.lines = [row(store())]
    db.current = subRow(sub({ amountPaise: 299900, currentStart: iso(Date.now() - 15 * DAY), currentEnd: iso(Date.now() + 15 * DAY) }))
    const r = await applyChange(T, { add: [{ kind: 'ad_free' }] }, { email: 'o@x.in' })
    expect(r.status).toBe('checkout')
    const opts = rz.createBillingSubscription.mock.calls[0][0]
    expect(opts.amountPaise).toBe(349900)
    expect(opts.upfrontPaise).toBeGreaterThan(0)
    expect(opts.startAt).toBe(Math.floor(Date.parse(db.current.current_end) / 1000))
    const insert = db.calls.find(c => c.sql.includes('INSERT INTO billing_subscriptions'))!
    expect(insert.params[5]).toBe(false) // is_current
    expect(insert.params[11]).toBe('bs-cur') // replaces_id
    expect(JSON.parse(insert.params[10])).toEqual({})
    expect(db.calls.some(c => c.sql.includes("INSERT INTO razorpay_subscription_index") && c.params.includes('sub_new'))).toBe(true)
    expect(rz.cancelSubscription).not.toHaveBeenCalled()
  })

  it('a first subscription is current at once and mirrored for a store', async () => {
    const r = await applyChange(T, { add: [{ kind: 'store_plan', amountPaise: 299900 }], immediate: true }, { email: 'o@x.in' })
    expect(r.status).toBe('checkout')
    const insert = db.calls.find(c => c.sql.includes('INSERT INTO billing_subscriptions'))!
    expect(insert.params[5]).toBe(true)
    expect(db.calls.some(c => c.sql.startsWith('UPDATE tenants SET razorpay_subscription_id') && c.params[1] === 'sub_new')).toBe(true)
  })

  it('cancels the Razorpay subscription it just made when the database write fails', async () => {
    db.failInsert = true
    await expect(applyChange(T, { add: [{ kind: 'ad_free' }] }, { email: 'o@x.in' })).rejects.toThrow('db down')
    expect(rz.cancelSubscription).toHaveBeenCalledWith('sub_new', { cancelAtCycleEnd: false })
    expect(db.calls.some(c => c.sql === 'ROLLBACK')).toBe(true)
  })

  it('removing everything cancels at cycle end', async () => {
    db.lines = [row(line())]
    db.current = subRow(sub({ currentStart: iso(Date.now() - 15 * DAY), currentEnd: iso(Date.now() + 15 * DAY) }))
    const r = await applyChange(T, { remove: [{ kind: 'ad_free' }] }, { email: 'o@x.in' })
    expect(r.status).toBe('cancelled')
    expect(rz.cancelSubscription).toHaveBeenCalledWith('sub_cur', { cancelAtCycleEnd: true })
    expect(rz.createBillingSubscription).not.toHaveBeenCalled()
  })
})
