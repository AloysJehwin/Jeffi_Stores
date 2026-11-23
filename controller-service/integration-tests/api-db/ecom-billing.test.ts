// @vitest-environment node
//
// DB-backed API tests (jeffi_test): the workspace subscription (lib/billing) through its owner routes and the
// platform Razorpay webhook. ad-free and messaging-addon (GET/POST), subscription (GET), subscribe (GET), then a
// signed webhook replay (authenticated → charged → replayed → halted) through the real /api/webhooks/razorpay
// handler, dispatcher and razorpay_subscription_index. The add-on routes gate via ownerApi(request), which reads
// the owner_sid cookie through next/headers cookies(), so only next/headers is shimmed. The Razorpay SDK is a fake
// (no network), invoices, emails and provisioning are stubbed; every SQL statement runs against jeffi_test.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb } from '../../../packages/store-core/integration-tests/db/harness'
import { makeOwnerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

let ownerSidCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => (name === 'owner_sid' && ownerSidCookie ? { value: ownerSidCookie } : undefined),
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

const rz = vi.hoisted(() => {
  let n = 0
  return {
    created: [] as any[],
    cancelled: [] as any[],
    refunded: [] as any[],
    api: {
      plans: { create: vi.fn(async () => ({ id: `plan_dbt_${++n}` })) },
      subscriptions: {
        create: vi.fn(async (o: any) => {
          const id = `sub_dbt_${crypto.randomUUID().slice(0, 8)}`
          rz.created.push({ id, ...o })
          return { id, short_url: `https://rzp.test/${id}` }
        }),
        cancel: vi.fn(async (id: string, o: any) => {
          rz.cancelled.push({ id, ...o })
          return { status: 'cancelled' }
        }),
        fetch: vi.fn(async () => ({})),
      },
      payments: { refund: vi.fn(async (id: string, o: any) => (rz.refunded.push({ id, ...o }), { id: 'rfnd_x' })) },
      invoices: { all: vi.fn(async () => ({ items: [] })) },
    },
  }
})
vi.mock('@/lib/payments/razorpay', async orig => ({ ...((await orig()) as object), getRazorpayInstance: () => rz.api }))
vi.mock('@/lib/billing/platform-invoice', () => ({ issuePlatformInvoiceLater: vi.fn(), issuePlatformInvoice: vi.fn() }))
vi.mock('@/lib/shared/ecom-emails', async orig => {
  const mod = (await orig()) as Record<string, unknown>
  return Object.fromEntries(Object.entries(mod).map(([k, v]) => [k, typeof v === 'function' ? vi.fn().mockResolvedValue(undefined) : v]))
})
vi.mock('@controller/lib/provisioning/trigger', () => ({ triggerProvisioning: vi.fn().mockResolvedValue({ ok: true }), resolveRestoreKey: vi.fn() }))
vi.mock('@controller/lib/provisioning/start-store', () => ({ startStoreIfReady: vi.fn(), startStore: vi.fn() }))

const SECRET = 'test-webhook-secret'

describe.skipIf(!API_DB_ENABLED)('controller ecom billing API (real DB, owner session)', () => {
  let msgGET: (req: any) => Promise<Response>
  let msgPOST: (req: any) => Promise<Response>
  let adFreeGET: (req: any) => Promise<Response>
  let adFreePOST: (req: any) => Promise<Response>
  let subGET: (req: any) => Promise<Response>
  let subscribeGET: (req: any) => Promise<Response>
  let webhookPOST: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let cp: any
  let sid = ''
  let ownerId = ''
  const tenantId = crypto.randomUUID()
  const slug = 'apitest-ecom-bill-' + crypto.randomBytes(3).toString('hex')
  const email = `apitest-owner-${crypto.randomBytes(3).toString('hex')}@jeffi.test`
  const u = (path: string) => `http://localhost${path}?tenant=${slug}`
  const nowSec = Math.floor(Date.now() / 1000)
  let rzpSub = ''

  async function signed(event: string, entity: Record<string, unknown>, payment?: Record<string, unknown>, createdAt = nowSec) {
    const raw = JSON.stringify({
      event,
      account_id: 'acc_platform',
      created_at: createdAt,
      payload: { subscription: { entity: { notes: { tenant_id: tenantId }, ...entity } }, ...(payment ? { payment: { entity: payment } } : {}) },
    })
    const { NextRequest } = await import('next/server')
    return new NextRequest('http://localhost/api/webhooks/razorpay', {
      method: 'POST',
      headers: { 'x-razorpay-signature': crypto.createHmac('sha256', SECRET).update(raw).digest('hex'), 'x-razorpay-event-id': `evt_${event}_${createdAt}` },
      body: raw,
    })
  }

  beforeAll(async () => {
    requireTestDb()
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET
    process.env.RAZORPAY_KEY_ID = 'rzp_test_dbtier'
    db = await import('@/lib/shared/db')
    const ownerSession = await import('@/lib/auth/owner-session')
    const reg = await import('@/lib/tenant-registry')
    cp = reg.controlPlanePool()
    const msg = await import('@controller/app/api/(ecom)/ecom/billing/messaging-addon/route')
    msgGET = msg.GET as any
    msgPOST = msg.POST as any
    const adf = await import('@controller/app/api/(ecom)/ecom/billing/ad-free/route')
    adFreeGET = adf.GET as any
    adFreePOST = adf.POST as any
    subGET = (await import('@controller/app/api/(ecom)/ecom/billing/subscription/route')).GET as any
    subscribeGET = (await import('@controller/app/api/(ecom)/ecom/billing/subscribe/route')).GET as any
    webhookPOST = (await import('@controller/app/api/(public)/webhooks/razorpay/route')).POST as any
    ;({ sid, owner: { id: ownerId } } = await makeOwnerSession(ownerSession, email))

    await cp.query(
      `INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1,$2,'API Test Ecom Store','active','{store}'::text[]) ON CONFLICT (id) DO NOTHING`,
      [tenantId, slug]
    )
    await cp.query(`INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ownerId, tenantId])
  })

  afterAll(async () => {
    // Fake plan ids cached in jeffi_test's platform_infra by this file.
    await cp.query(
      `UPDATE platform_infra SET value = (SELECT COALESCE(jsonb_object_agg(k, v), '{}'::jsonb) FROM jsonb_each(value::jsonb) e(k, v) WHERE v::text NOT LIKE '"plan_dbt_%')::text
        WHERE key = 'razorpay_plans'`
    ).catch(() => {})
    await cp.query(`DELETE FROM settlement_ledger WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM razorpay_subscription_index WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM billing_charges WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM billing_lines WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM billing_subscriptions WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM wallet_ledger WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM owner_tenants WHERE owner_id=$1`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='owner'`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM owners WHERE id=$1`, [ownerId]).catch(() => {})
    await endPool()
  })

  // ── gates and reads ───────────────────────────────────────────────────────
  it('add-on routes: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    expect((await msgGET(await apiRequest('GET', u('/api/ecom/billing/messaging-addon')) as any)).status).toBe(401)
    expect((await adFreeGET(await apiRequest('GET', u('/api/ecom/billing/ad-free')) as any)).status).toBe(401)
    expect((await subGET(await apiRequest('GET', u('/api/ecom/billing/subscription')) as any)).status).toBe(401)
  })

  it('messaging-addon: GET returns the add-on, its price and where it stands on the bill', async () => {
    ownerSidCookie = sid
    const res = await msgGET(await apiRequest('GET', u('/api/ecom/billing/messaging-addon')) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ tier: 'none', lineStatus: null, checkoutUrl: null })
    expect(body).toHaveProperty('priceInr')
    expect(body).toHaveProperty('entitlement')
    expect(body).not.toHaveProperty('renew')
    expect(body).not.toHaveProperty('balanceInr')
  })

  it('messaging-addon and ad-free: 400 on an unknown or retired action', async () => {
    ownerSidCookie = sid
    for (const action of ['nope', 'buy', 'renew_on']) {
      expect((await msgPOST(await apiRequest('POST', u('/api/ecom/billing/messaging-addon'), { body: { action } }) as any)).status).toBe(400)
      expect((await adFreePOST(await apiRequest('POST', u('/api/ecom/billing/ad-free'), { body: { action } }) as any)).status).toBe(400)
    }
  })

  it('removing an add-on that is not on the bill changes nothing (no Razorpay call)', async () => {
    ownerSidCookie = sid
    const res = await msgPOST(await apiRequest('POST', u('/api/ecom/billing/messaging-addon'), { body: { action: 'remove' } }) as any)
    expect(res.status).toBe(200)
    expect(rz.api.subscriptions.create).not.toHaveBeenCalled()
  })

  // ── the subscription, end to end ──────────────────────────────────────────
  it('ad-free add: a first subscription the owner checks out, its line waiting for the payment', async () => {
    ownerSidCookie = sid
    const res = await adFreePOST(await apiRequest('POST', u('/api/ecom/billing/ad-free'), { body: { action: 'add' } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    rzpSub = rz.created[0].id
    expect(body.checkoutUrl).toBe(`https://rzp.test/${rzpSub}`)
    expect(body.lineStatus).toBe('awaiting_payment')
    expect(rz.created[0]).toMatchObject({ customer_notify: 1, quantity: 1 })
    expect(rz.created[0].start_at).toBeUndefined()
    // Combined plan cache keyed by mode: a test key never reuses a live plan.
    const plans = JSON.parse((await cp.query(`SELECT value FROM platform_infra WHERE key = 'razorpay_plans'`)).rows[0].value)
    expect(plans['combo:test:monthly:50000']).toBe(rz.created[0].plan_id)
    const s = (await cp.query(`SELECT * FROM billing_subscriptions WHERE tenant_id=$1`, [tenantId])).rows
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ razorpay_subscription_id: rzpSub, status: 'created', is_current: true, amount_paise: 50000, mode: 'test' })
    const idx = (await cp.query(`SELECT collecting_account, local_subscription_id FROM razorpay_subscription_index WHERE razorpay_subscription_id=$1`, [rzpSub])).rows[0]
    expect(idx).toEqual({ collecting_account: 'billing', local_subscription_id: s[0].id })
    const l = (await cp.query(`SELECT status, subscription_id FROM billing_lines WHERE tenant_id=$1 AND kind='ad_free'`, [tenantId])).rows[0]
    expect(l).toEqual({ status: 'awaiting_payment', subscription_id: s[0].id })
  })

  it('subscription GET shows the line and the waiting checkout', async () => {
    ownerSidCookie = sid
    const body = await (await subGET(await apiRequest('GET', u('/api/ecom/billing/subscription')) as any)).json()
    expect(body.current).toMatchObject({ status: 'created', amountPaise: 50000, checkoutUrl: `https://rzp.test/${rzpSub}` })
    expect(body.lines).toEqual([expect.objectContaining({ kind: 'ad_free', status: 'awaiting_payment', amountPaise: 50000 })])
    expect(body.monthlyPaise).toBe(50000)
  })

  it('webhook: subscription.authenticated through the index marks it authorised', async () => {
    const res = await webhookPOST(await signed('subscription.authenticated', { id: rzpSub, status: 'authenticated', payment_method: 'upi' }))
    expect(res.status).toBe(200)
    const s = (await cp.query(`SELECT status, payment_method FROM billing_subscriptions WHERE razorpay_subscription_id=$1`, [rzpSub])).rows[0]
    expect(s).toEqual({ status: 'authenticated', payment_method: 'upi' })
  })

  it('webhook: subscription.charged records the charge, starts the line and extends ad_free_until', async () => {
    const end = nowSec + 30 * 86400
    const pay = { id: `pay_dbt_${crypto.randomBytes(4).toString('hex')}`, amount: 50000, invoice_id: 'inv_dbt_1' }
    const res = await webhookPOST(await signed('subscription.charged', { id: rzpSub, status: 'active', current_start: nowSec, current_end: end }, pay, nowSec + 1))
    expect(res.status).toBe(200)
    const charges = (await cp.query(`SELECT razorpay_payment_id, amount_paise, refunded_paise FROM billing_charges WHERE tenant_id=$1`, [tenantId])).rows
    expect(charges).toEqual([{ razorpay_payment_id: pay.id, amount_paise: 50000, refunded_paise: 0 }])
    expect((await cp.query(`SELECT status FROM billing_lines WHERE tenant_id=$1 AND kind='ad_free'`, [tenantId])).rows[0].status).toBe('active')
    const t = (await cp.query(`SELECT ad_free_until FROM tenants WHERE id=$1`, [tenantId])).rows[0]
    expect(new Date(t.ad_free_until).getTime()).toBeGreaterThan((end + 86400 - 60) * 1000)
    const s = (await cp.query(`SELECT status, current_end FROM billing_subscriptions WHERE razorpay_subscription_id=$1`, [rzpSub])).rows[0]
    expect(s.status).toBe('active')
    expect(new Date(s.current_end).getTime()).toBe(end * 1000)
    expect((await cp.query(`SELECT amount FROM settlement_ledger WHERE tenant_id=$1 AND entry_type='subscription_charge'`, [tenantId])).rows.map((r: any) => Number(r.amount))).toEqual([-500])

    // A replayed charge is recorded once.
    await webhookPOST(await signed('subscription.charged', { id: rzpSub, status: 'active', current_start: nowSec, current_end: end }, pay, nowSec + 2))
    expect((await cp.query(`SELECT count(*)::int AS n FROM billing_charges WHERE tenant_id=$1`, [tenantId])).rows[0].n).toBe(1)
    expect(rz.refunded).toHaveLength(0)
  })

  it('ad-free remove: the only line, so the subscription cancels at cycle end and the line runs until then', async () => {
    ownerSidCookie = sid
    const res = await adFreePOST(await apiRequest('POST', u('/api/ecom/billing/ad-free'), { body: { action: 'remove' } }) as any)
    expect(res.status).toBe(200)
    expect(rz.cancelled).toContainEqual({ id: rzpSub, cancel_at_cycle_end: 1 })
    const l = (await cp.query(`SELECT status, ends_at FROM billing_lines WHERE tenant_id=$1 AND kind='ad_free'`, [tenantId])).rows[0]
    expect(l.status).toBe('ending')
    expect(new Date(l.ends_at).getTime()).toBe((nowSec + 30 * 86400) * 1000)
    expect((await res.json()).lineStatus).toBe('ending')
  })

  it('webhook: an older event does not move the status back', async () => {
    await webhookPOST(await signed('subscription.pending', { id: rzpSub, status: 'pending' }, undefined, nowSec - 3600))
    expect((await cp.query(`SELECT status FROM billing_subscriptions WHERE razorpay_subscription_id=$1`, [rzpSub])).rows[0].status).toBe('active')
  })

  it('webhook: subscription.halted gives the lines a 7-day grace', async () => {
    await webhookPOST(await signed('subscription.halted', { id: rzpSub, status: 'halted' }, undefined, nowSec + 10))
    const s = (await cp.query(`SELECT status, grace_until FROM billing_subscriptions WHERE razorpay_subscription_id=$1`, [rzpSub])).rows[0]
    expect(s.status).toBe('halted')
    const days = (new Date(s.grace_until).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(6.9)
    expect(days).toBeLessThan(7.1)
    expect((await cp.query(`SELECT grace_until FROM billing_lines WHERE tenant_id=$1 AND kind='ad_free'`, [tenantId])).rows[0].grace_until).not.toBeNull()
  })

  // ── the switch from the wallet ────────────────────────────────────────────
  it('subscribe GET lists what is still paid from the wallet, the credit and the deadline', async () => {
    ownerSidCookie = sid
    const grace = new Date(Date.now() + 14 * 86_400_000).toISOString()
    await cp.query(
      `INSERT INTO billing_lines (tenant_id, kind, ref, amount_paise, status, grace_until) VALUES ($1, 'messaging_addon', 'both', 50000, 'legacy_wallet', $2)`,
      [tenantId, grace]
    )
    const body = await (await subscribeGET(await apiRequest('GET', u('/api/ecom/billing/subscribe')) as any)).json()
    expect(body.legacy).toEqual([expect.objectContaining({ kind: 'messaging_addon', amountPaise: 50000, label: 'SMS & WhatsApp add-on' })])
    expect(body.creditInr).toBe(0) // no wallet debit to credit from
    expect(new Date(body.deadline).getTime()).toBe(new Date(grace).getTime())
    expect(body.quote.lines).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'messaging_addon', amountPaise: 50000 })]))
  })
})
