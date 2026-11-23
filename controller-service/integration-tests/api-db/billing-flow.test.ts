// @vitest-environment node
//
// DB-backed (jeffi_test) flows of the workspace subscription engine (controller lib/billing) that change a paying
// subscription: a store's included Showcase site, an add-on as a replacement that keeps the billing date, its
// authorisation through the signed platform webhook (takeEffect), and a full billing sweep run. The Razorpay SDK is a
// fake (no network); emails, invoices and provisioning are stubbed. Every SQL statement runs against jeffi_test.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb } from '../../../packages/store-core/integration-tests/db/harness'
import { endPool } from '../../../packages/store-core/integration-tests/db/helpers'

const rz = vi.hoisted(() => ({
  created: [] as any[],
  cancelled: [] as any[],
  api: {
    plans: { create: vi.fn(async () => ({ id: `plan_flow_${Math.random().toString(36).slice(2, 8)}` })) },
    subscriptions: {
      create: vi.fn(async (o: any) => {
        const id = `sub_flow_${Math.random().toString(36).slice(2, 10)}`
        rz.created.push({ id, ...o })
        return { id, short_url: `https://rzp.test/${id}` }
      }),
      cancel: vi.fn(async (id: string, o: any) => (rz.cancelled.push({ id, ...o }), { status: 'cancelled' })),
      fetch: vi.fn(async () => ({})),
    },
    payments: { refund: vi.fn(async () => ({ id: 'rfnd_flow' })) },
    invoices: { all: vi.fn(async () => ({ items: [] })) },
  },
}))
vi.mock('@/lib/payments/razorpay', async orig => ({ ...((await orig()) as object), getRazorpayInstance: () => rz.api }))
vi.mock('@/lib/billing/platform-invoice', () => ({ issuePlatformInvoiceLater: vi.fn(), issuePlatformInvoice: vi.fn() }))
vi.mock('@/lib/shared/ecom-emails', async orig => {
  const mod = (await orig()) as Record<string, unknown>
  return Object.fromEntries(Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn().mockResolvedValue(undefined) : v]))
})
vi.mock('@controller/lib/provisioning/trigger', () => ({ triggerProvisioning: vi.fn().mockResolvedValue({ ok: true }), resolveRestoreKey: vi.fn() }))
vi.mock('@controller/lib/provisioning/start-store', () => ({ startStoreIfReady: vi.fn(), startStore: vi.fn() }))

const SECRET = 'test-webhook-secret'
const DAY = 86_400_000

describe.skipIf(!API_DB_ENABLED)('billing engine flows (real DB)', () => {
  let cp: any
  let engine: typeof import('@controller/lib/billing/subscription')
  let sweep: typeof import('@controller/lib/billing/sweep')
  let webhookPOST: (req: any) => Promise<Response>
  const tenantId = crypto.randomUUID()
  const ownerId = crypto.randomUUID()
  const siteId = crypto.randomUUID()
  const curId = crypto.randomUUID()
  const tag = crypto.randomBytes(3).toString('hex')
  const curRzp = `sub_flow_cur_${tag}`
  const cycleEnd = new Date(Date.now() + 15 * DAY)
  const payer = { email: `flow-${tag}@jeffi.test` }
  let replacementRzp = ''

  async function signed(event: string, entity: Record<string, unknown>, payment?: Record<string, unknown>) {
    const raw = JSON.stringify({ event, created_at: Math.floor(Date.now() / 1000), payload: { subscription: { entity }, ...(payment ? { payment: { entity: payment } } : {}) } })
    const { NextRequest } = await import('next/server')
    return new NextRequest('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': crypto.createHmac('sha256', SECRET).update(raw).digest('hex') },
      body: raw,
    })
  }

  beforeAll(async () => {
    requireTestDb()
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET
    process.env.RAZORPAY_KEY_ID = 'rzp_test_flow'
    delete process.env.RAZORPAY_KEY_SECRET // the sweep's Razorpay catch-up stays off
    cp = (await import('@/lib/tenant-registry')).controlPlanePool()
    engine = await import('@controller/lib/billing/subscription')
    sweep = await import('@controller/lib/billing/sweep')
    webhookPOST = (await import('@controller/app/api/(public)/webhooks/razorpay/route')).POST as any

    await cp.query(`INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1, $2, 'Flow Store', 'active', '{store}'::text[])`, [tenantId, `flow-${tag}`])
    // A paying store: its plan on a current subscription, 15 days into a 30-day cycle.
    await cp.query(
      `INSERT INTO billing_subscriptions (id, tenant_id, razorpay_subscription_id, mode, status, is_current, amount_paise, lines, current_start, current_end)
       VALUES ($1, $2, $3, 'test', 'active', true, 299900, '[{"kind":"store_plan","ref":"","label":"Basic plan","amountPaise":299900}]', $4, $5)`,
      [curId, tenantId, curRzp, new Date(Date.now() - 15 * DAY), cycleEnd]
    )
    await cp.query(`INSERT INTO razorpay_subscription_index (razorpay_subscription_id, tenant_id, collecting_account, local_subscription_id) VALUES ($1, $2, 'billing', $3)`, [curRzp, tenantId, curId])
    await cp.query(`INSERT INTO billing_lines (tenant_id, kind, ref, amount_paise, status, subscription_id) VALUES ($1, 'store_plan', '', 299900, 'active', $2)`, [tenantId, curId])
    await cp.query(
      `INSERT INTO showcase_sites (id, tenant_id, owner_id, slug, status, page, published_at, trial_ends_at, paid_until)
       VALUES ($1, $2, $3, $4, 'live', '{}'::jsonb, now(), now() + interval '3 days', now() + interval '3 days')`,
      [siteId, tenantId, ownerId, `flow-site-${tag}`]
    )
  })

  afterAll(async () => {
    // Fake plan ids cached in jeffi_test's platform_infra by this file.
    await cp.query(
      `UPDATE platform_infra SET value = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(value::jsonb) e(k, v) WHERE v::text NOT LIKE '"plan_flow_%')::text
        WHERE key = 'razorpay_plans'`
    ).catch(() => {})
    await cp.query(`DELETE FROM showcase_sites WHERE id = $1`, [siteId]).catch(() => {})
    await cp.query(`DELETE FROM razorpay_subscription_index WHERE tenant_id = $1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM billing_charges WHERE tenant_id = $1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM billing_lines WHERE tenant_id = $1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM billing_subscriptions WHERE tenant_id = $1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM settlement_ledger WHERE tenant_id = $1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => {})
    await endPool()
  })

  it("a store's first Showcase site joins the paying subscription for free (decision 9)", async () => {
    await cp.query(`INSERT INTO billing_lines (tenant_id, kind, ref, amount_paise, status, trial_ends_at) VALUES ($1, 'showcase_site', $2, 20000, 'trial', now() + interval '3 days')`, [tenantId, siteId])
    const r = await engine.addLine(tenantId, { kind: 'showcase_site', ref: siteId }, payer)
    expect(r.status).toBe('unchanged')
    expect(rz.api.subscriptions.create).not.toHaveBeenCalled()
    const l = (await cp.query(`SELECT status, subscription_id FROM billing_lines WHERE tenant_id = $1 AND kind = 'showcase_site'`, [tenantId])).rows[0]
    expect(l).toEqual({ status: 'active', subscription_id: curId })
    const site = (await cp.query(`SELECT paid_until FROM showcase_sites WHERE id = $1`, [siteId])).rows[0]
    expect(new Date(site.paid_until).getTime()).toBe(cycleEnd.getTime() + DAY)
  })

  it('an add-on is a replacement starting at cycle end, with the rest of the cycle upfront; nothing is cancelled yet', async () => {
    const r = await engine.addLine(tenantId, { kind: 'ad_free' }, payer)
    expect(r.status).toBe('checkout')
    const c = rz.created[0]
    replacementRzp = c.id
    expect(c.start_at).toBe(Math.floor(cycleEnd.getTime() / 1000))
    expect(c.addons).toHaveLength(1)
    expect(c.addons[0].item.amount).toBeGreaterThan(24000)
    expect(c.addons[0].item.amount).toBeLessThan(26000)
    expect(rz.cancelled).toHaveLength(0)
    const s = (await cp.query(`SELECT is_current, status, replaces_id, amount_paise FROM billing_subscriptions WHERE razorpay_subscription_id = $1`, [replacementRzp])).rows[0]
    expect(s).toEqual({ is_current: false, status: 'created', replaces_id: curId, amount_paise: 349900 })
    const overview = await (await import('@controller/lib/billing/overview')).billingOverview(tenantId)
    expect(overview.pending).toMatchObject({ amountPaise: 349900 })
  })

  it('a second change while the first waits replaces it, keeping its add-on', async () => {
    const r = await engine.addLine(tenantId, { kind: 'messaging_addon', ref: 'both' }, payer)
    expect(r.status).toBe('checkout')
    expect(rz.cancelled).toContainEqual({ id: replacementRzp, cancel_at_cycle_end: 0 })
    replacementRzp = rz.created[1].id
    const lines = (await cp.query(`SELECT kind, status FROM billing_lines WHERE tenant_id = $1 AND status <> 'ended' ORDER BY kind`, [tenantId])).rows
    expect(lines).toEqual([
      { kind: 'ad_free', status: 'awaiting_payment' },
      { kind: 'messaging_addon', status: 'awaiting_payment' },
      { kind: 'showcase_site', status: 'active' },
      { kind: 'store_plan', status: 'active' },
    ])
    expect((await cp.query(`SELECT amount_paise FROM billing_subscriptions WHERE razorpay_subscription_id = $1`, [replacementRzp])).rows[0].amount_paise).toBe(
      299900 + 50000 + (await (await import('@controller/lib/billing/lines')).listPricePaise('messaging_addon', tenantId))
    )
  })

  it('authorising the replacement (webhook) makes it current, supersedes the old one and starts its add-ons', async () => {
    const upfront = rz.created[1].addons[0].item.amount
    const res = await webhookPOST(await signed('subscription.authenticated', { id: replacementRzp, status: 'authenticated' }, { id: `pay_up_${tag}`, amount: upfront }))
    expect(res.status).toBe(200)
    const subs = (await cp.query(`SELECT razorpay_subscription_id AS id, is_current, status FROM billing_subscriptions WHERE tenant_id = $1 AND status <> 'abandoned' ORDER BY created_at`, [tenantId])).rows
    expect(subs).toEqual([
      { id: curRzp, is_current: false, status: 'superseded' },
      { id: replacementRzp, is_current: true, status: 'authenticated' },
    ])
    expect(rz.cancelled).toContainEqual({ id: curRzp, cancel_at_cycle_end: 1 })
    const t = (await cp.query(`SELECT ad_free_until, messaging_addon, messaging_addon_until, razorpay_subscription_id FROM tenants WHERE id = $1`, [tenantId])).rows[0]
    expect(new Date(t.ad_free_until).getTime()).toBe(cycleEnd.getTime() + DAY)
    expect(t.messaging_addon).toBe('both')
    expect(t.razorpay_subscription_id).toBe(replacementRzp)
    expect((await cp.query(`SELECT amount_paise FROM billing_charges WHERE razorpay_payment_id = $1`, [`pay_up_${tag}`])).rows[0].amount_paise).toBe(upfront)

    // The superseded one's cancellation is expected: nothing ends.
    await webhookPOST(await signed('subscription.cancelled', { id: curRzp, status: 'cancelled', current_end: Math.floor(Date.now() / 1000) }))
    expect((await cp.query(`SELECT count(*)::int AS n FROM billing_lines WHERE tenant_id = $1 AND status IN ('ending','ended')`, [tenantId])).rows[0].n).toBe(0)
  })

  it('the daily sweep runs every step against the real schema', async () => {
    const run = await sweep.runBillingSweep()
    expect(run.failed).toEqual([])
  })
})
