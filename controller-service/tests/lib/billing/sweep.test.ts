import { describe, it, expect, vi, beforeEach } from 'vitest'

// The daily billing_sweep (lib/billing/sweep.ts). SQL is answered by fragment and recorded.

const st = vi.hoisted(() => ({
  calls: [] as { sql: string; params: any[] }[],
  answers: [] as { frag: string; rows: any[]; once?: boolean; throws?: boolean }[],
}))
const query = vi.hoisted(() =>
  vi.fn(async (sql: string, params: any[] = []) => {
    st.calls.push({ sql, params })
    const i = st.answers.findIndex(a => sql.includes(a.frag))
    if (i < 0) return { rows: [], rowCount: 0 }
    const a = st.answers[i]
    if (a.once) st.answers.splice(i, 1)
    if (a.throws) throw new Error(`boom: ${a.frag}`)
    return { rows: a.rows, rowCount: a.rows.length }
  })
)
vi.mock('@/lib/tenant-registry', () => ({ controlPlanePool: () => ({ query }), setSubscriptionStatus: vi.fn(), stopProvisioningJob: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/payments/wallet', () => ({ FLAGSHIP_TENANT_ID: '00000000-0000-0000-0000-000000000000' }))
vi.mock('@/lib/billing/ad-free', () => ({ AD_FREE_PRICE_INR: 500 }))
vi.mock('@/lib/billing/messaging-addon', () => ({ getMessagingAddonPricing: vi.fn().mockResolvedValue({ priceInr: 500 }) }))
const pauseShowcase = vi.hoisted(() => vi.fn(async (id: string) => ({ id, status: 'paused' })))
vi.mock('@/lib/showcase/store', () => ({ pauseShowcase }))
const rz = vi.hoisted(() => ({ cancelSubscription: vi.fn(), getSubscription: vi.fn(), listSubscriptionInvoices: vi.fn() }))
vi.mock('@controller/lib/payments/razorpay-subscriptions', () => rz)
const trigger = vi.hoisted(() => vi.fn().mockResolvedValue({ ok: true }))
vi.mock('@controller/lib/provisioning/trigger', () => ({ triggerProvisioning: trigger }))
const subs = vi.hoisted(() => ({ current: null as any, abandonPending: vi.fn().mockResolvedValue(1) }))
vi.mock('@controller/lib/billing/subscription', async () => {
  const actual = await vi.importActual<any>('@controller/lib/billing/subscription')
  return { toSubscription: actual.toSubscription, isPaying: actual.isPaying, abandonPending: subs.abandonPending, currentSubscription: vi.fn(async () => subs.current) }
})
const lines = vi.hoisted(() => ({ list: [] as any[] }))
vi.mock('@controller/lib/billing/lines', async () => {
  const actual = await vi.importActual<any>('@controller/lib/billing/lines')
  return { ...actual, listLines: vi.fn(async () => lines.list), patchLine: vi.fn(), lineLabels: vi.fn(async () => (l: any) => `Showcase site ${l.ref}`) }
})
vi.mock('@controller/lib/billing/entitlements', () => ({ extendEntitlements: vi.fn().mockResolvedValue([]) }))
vi.mock('@controller/lib/billing/notify', () => ({ notifyBilling: vi.fn().mockResolvedValue(undefined) }))
const onBillingSubscription = vi.hoisted(() => vi.fn())
vi.mock('@controller/lib/billing/webhook', () => ({ onBillingSubscription }))

import { closeEndedLines, runBillingSweep, syncShowcaseLines } from '@controller/lib/billing/sweep'
import { setSubscriptionStatus } from '@/lib/tenant-registry'
import { patchLine } from '@controller/lib/billing/lines'
import { extendEntitlements } from '@controller/lib/billing/entitlements'
import { notifyBilling } from '@controller/lib/billing/notify'
import { DAY, T, iso, line, sub } from './fixtures'

const row = (l: any) => ({
  id: l.id, tenant_id: l.tenantId, kind: l.kind, ref: l.ref, amount_paise: l.amountPaise, status: l.status, subscription_id: l.subscriptionId,
  trial_ends_at: l.trialEndsAt, ends_at: l.endsAt, grace_until: l.graceUntil, legacy_ref: l.legacyRef, last_notice: l.lastNotice, created_at: l.createdAt,
})

beforeEach(() => {
  vi.clearAllMocks()
  st.calls = []
  st.answers = []
  subs.current = null
  lines.list = []
  rz.cancelSubscription.mockResolvedValue({})
  delete process.env.RAZORPAY_KEY_ID
  delete process.env.RAZORPAY_KEY_SECRET
})

describe('trials', () => {
  it('pauses a site whose trial ended with no subscription covering it (decision 2: no grace)', async () => {
    const t = line({ kind: 'showcase_site', ref: 'site-1', status: 'trial', trialEndsAt: iso(Date.now() - 60_000) })
    st.answers.push({ frag: "l.status = 'trial' AND l.trial_ends_at <= now()", rows: [row(t)] })
    const run = await runBillingSweep()
    expect(run.trialsEnded).toBe(1)
    expect(patchLine).toHaveBeenCalledWith(t.id, expect.objectContaining({ status: 'ended', last_notice: 'trial_ended' }))
    expect(pauseShowcase).toHaveBeenCalledWith('site-1', 'unpaid')
    expect(notifyBilling).toHaveBeenCalledWith(T, { kind: 'trial_ended', site: 'site-1' })
  })

  it("starts a paying store's included site for free instead of pausing it (decision 9)", async () => {
    const t = line({ kind: 'showcase_site', ref: 'site-1', status: 'trial', trialEndsAt: iso(Date.now() - 60_000) })
    st.answers.push({ frag: "l.status = 'trial' AND l.trial_ends_at <= now()", rows: [row(t)] })
    subs.current = sub({ currentEnd: iso(Date.now() + 10 * DAY) })
    lines.list = [line({ kind: 'store_plan', amountPaise: 299900 }), t]
    const run = await runBillingSweep()
    expect(run.trialsEnded).toBe(0)
    expect(pauseShowcase).not.toHaveBeenCalled()
    expect(patchLine).toHaveBeenCalledWith(t.id, { status: 'active', subscription_id: 'bs-cur' })
    expect(extendEntitlements).toHaveBeenCalled()
  })

  it('reminds two days ahead, once', async () => {
    const t = line({ kind: 'showcase_site', ref: 'site-1', status: 'trial', trialEndsAt: iso(Date.now() + DAY) })
    st.answers.push({ frag: "last_notice IS DISTINCT FROM 'trial_ending'", rows: [row(t)] })
    const run = await runBillingSweep()
    expect(run.trialReminders).toBe(1)
    expect(patchLine).toHaveBeenCalledWith(t.id, { last_notice: 'trial_ending' })
    expect(notifyBilling).toHaveBeenCalledWith(T, expect.objectContaining({ kind: 'trial_ending', site: 'site-1' }))
  })
})

describe('grace and ends', () => {
  it('pauses sites whose halted subscription ran out of grace', async () => {
    const l = line({ kind: 'showcase_site', ref: 'site-2', graceUntil: iso(Date.now() - DAY) })
    st.answers.push({ frag: "l.last_notice IS DISTINCT FROM 'grace_paused'", rows: [row(l)] })
    const run = await runBillingSweep()
    expect(run.gracePaused).toBe(1)
    expect(notifyBilling).toHaveBeenCalledWith(T, { kind: 'site_paused', site: 'site-2' })
  })

  it('ends lines whose end has come: sites pause, a store closes and is torn down', async () => {
    st.answers.push({ frag: "WHERE status = 'ending' AND ends_at <= now()", rows: [row(line({ kind: 'showcase_site', ref: 'site-3', status: 'ended' })), row(line({ kind: 'store_plan', status: 'ended' }))] })
    st.answers.push({ frag: 'SELECT slug, status FROM tenants', rows: [{ slug: 'acme', status: 'active' }] })
    st.answers.push({ frag: 'FROM owner_tenants', rows: [{ owner_id: 'o-1' }] })
    const r = await closeEndedLines(T)
    expect(r).toEqual({ ended: 2, stores: 1 })
    expect(pauseShowcase).toHaveBeenCalledWith('site-3', 'unpaid')
    expect(setSubscriptionStatus).toHaveBeenCalledWith(T, 'cancelled', 'terminated')
    await vi.waitFor(() => expect(trigger).toHaveBeenCalled())
    expect(trigger).toHaveBeenCalledWith(expect.objectContaining({ action: 'deprovision', tenantId: T, reason: 'missed_payment' }))
    // Lowered prices whose date has come apply first.
    expect(st.calls[0].sql).toContain('amount_paise = next_amount_paise')
  })
})

describe('migration', () => {
  it('announces once, then ends what was not moved by its deadline', async () => {
    const open = line({ status: 'legacy_wallet', graceUntil: iso(Date.now() + 10 * DAY) })
    st.answers.push({ frag: "WHERE status = 'legacy_wallet'", rows: [row(open)], once: true })
    await runBillingSweep()
    expect(notifyBilling).toHaveBeenCalledWith(T, expect.objectContaining({ kind: 'migrate_announce' }))

    vi.clearAllMocks()
    const lapsed = line({ kind: 'showcase_site', ref: 'site-4', status: 'legacy_wallet', graceUntil: iso(Date.now() - DAY), lastNotice: 'migrate_announce' })
    st.answers.push({ frag: "WHERE status = 'legacy_wallet'", rows: [row(lapsed)], once: true })
    const run = await runBillingSweep()
    expect(run.migrationsLapsed).toBe(1)
    expect(pauseShowcase).toHaveBeenCalledWith('site-4', 'unpaid')
    expect(notifyBilling).toHaveBeenCalledWith(T, { kind: 'migrate_ended', items: ['Showcase site site-4'] })
  })
})

describe('abandoned checkouts and missed webhooks', () => {
  it('abandons replacements nobody approved', async () => {
    st.answers.push({ frag: 'SELECT DISTINCT tenant_id FROM billing_subscriptions', rows: [{ tenant_id: T }] })
    const run = await runBillingSweep()
    expect(subs.abandonPending).toHaveBeenCalledWith(T)
    expect(run.abandoned).toBe(1)
  })

  it('replays a charge Razorpay made but whose webhook never came', async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_x'
    process.env.RAZORPAY_KEY_SECRET = 's'
    st.answers.push({ frag: 'ORDER BY updated_at LIMIT 200', rows: [{ id: 'bs-cur', tenant_id: T, razorpay_subscription_id: 'sub_cur', status: 'active', is_current: true, billing_interval: 'monthly', amount_paise: 20000, created_at: iso(Date.now()) }] })
    rz.getSubscription.mockResolvedValue({ id: 'sub_cur', status: 'active' })
    rz.listSubscriptionInvoices.mockResolvedValue([{ id: 'inv_9', payment_id: 'pay_9', status: 'paid', amount: 20000, paid_at: 1 }])
    const run = await runBillingSweep()
    expect(onBillingSubscription).toHaveBeenCalledWith('subscription.charged', expect.objectContaining({ payload: expect.objectContaining({ payment: { entity: { id: 'pay_9', amount: 20000, invoice_id: 'inv_9' } } }) }), { tenantId: T, eventId: 'sweep:bs-cur' })
    expect(run.reconciled).toBe(1)
  })
})

describe('the run', () => {
  it('keeps going when a step fails and reports it', async () => {
    st.answers.push({ frag: 'INSERT INTO billing_lines', rows: [], throws: true })
    const run = await runBillingSweep()
    expect(run.failed).toEqual([{ what: 'sync', error: 'boom: INSERT INTO billing_lines' }])
    expect(st.calls.some(c => c.sql.includes("WHERE status = 'legacy_wallet'"))).toBe(true)
  })

  it("never bills the platform's own sites", async () => {
    await syncShowcaseLines()
    expect(st.calls[0].params).toEqual([20000, '00000000-0000-0000-0000-000000000000'])
  })
})
