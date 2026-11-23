// @vitest-environment node
//
// DB-backed API tests (jeffi_test) — controller ecom billing slice: change-plan (POST), messaging-addon
// (GET/POST), ad-free (GET/POST). change-plan gates via resolveOwnerSession; the add-on routes via
// ownerApi(request). Both read the owner_sid cookie through next/headers cookies() (request-scoped, THROWS
// when the handler is called directly), so we mock ONLY next/headers — the session sid is REAL and every
// handler's SQL runs against jeffi_test. Full upgrade/downgrade in change-plan hits Razorpay (external) and
// is NOT exercised; its validation + "no subscription" branches are DB-only and covered.
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

describe.skipIf(!API_DB_ENABLED)('controller ecom billing API (real DB, owner session)', () => {
  let changePlanPOST: (req: any) => Promise<Response>
  let msgGET: (req: any) => Promise<Response>
  let msgPOST: (req: any) => Promise<Response>
  let adFreeGET: (req: any) => Promise<Response>
  let adFreePOST: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let cp: any
  let sid = ''
  let ownerId = ''
  const tenantId = crypto.randomUUID()
  const slug = 'apitest-ecom-bill-' + crypto.randomBytes(3).toString('hex')
  const email = `apitest-owner-${crypto.randomBytes(3).toString('hex')}@jeffi.test`
  const u = (path: string) => `http://localhost${path}?tenant=${slug}`

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const ownerSession = await import('@/lib/auth/owner-session')
    const reg = await import('@/lib/tenant-registry')
    cp = reg.controlPlanePool()
    changePlanPOST = (await import('@controller/app/api/(ecom)/ecom/billing/change-plan/route')).POST as any
    const msg = await import('@controller/app/api/(ecom)/ecom/billing/messaging-addon/route')
    msgGET = msg.GET as any
    msgPOST = msg.POST as any
    const adf = await import('@controller/app/api/(ecom)/ecom/billing/ad-free/route')
    adFreeGET = adf.GET as any
    adFreePOST = adf.POST as any
    ;({ sid, owner: { id: ownerId } } = await makeOwnerSession(ownerSession, email))

    // Active store tenant (no razorpay_subscription_id → change-plan returns the "no subscription" 400).
    await cp.query(
      `INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1,$2,'API Test Ecom Store','active','{store}'::text[]) ON CONFLICT (id) DO NOTHING`,
      [tenantId, slug]
    )
    await cp.query(`INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ownerId, tenantId])
    // Fund the wallet so a `buy` add-on debit succeeds (ad-free ₹500, messaging ~₹500/mo).
    await cp.query(
      `INSERT INTO tenant_wallets (tenant_id, balance) VALUES ($1, 5000) ON CONFLICT (tenant_id) DO UPDATE SET balance = 5000`,
      [tenantId]
    )
  })

  afterAll(async () => {
    await cp.query(`DELETE FROM wallet_ledger WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM tenant_wallets WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM owner_tenants WHERE owner_id=$1`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='owner'`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM owners WHERE id=$1`, [ownerId]).catch(() => {})
    await endPool()
  })

  // ── change-plan POST ───────────────────────────────────────────────────────
  it('change-plan: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await changePlanPOST(await apiRequest('POST', 'http://localhost/api/ecom/billing/change-plan', { body: { tenantId, planSlug: 'x' } }) as any)
    expect(res.status).toBe(401)
  })

  it('change-plan: 400 on invalid JSON', async () => {
    ownerSidCookie = sid
    // No body → request.json() rejects → route returns Invalid JSON.
    const res = await changePlanPOST(await apiRequest('POST', 'http://localhost/api/ecom/billing/change-plan') as any)
    expect(res.status).toBe(400)
  })

  it('change-plan: 400 on an invalid body (missing planSlug)', async () => {
    ownerSidCookie = sid
    const res = await changePlanPOST(await apiRequest('POST', 'http://localhost/api/ecom/billing/change-plan', { body: { tenantId } }) as any)
    expect(res.status).toBe(400)
  })

  it('change-plan: 404 when the owner does not own the target tenant', async () => {
    ownerSidCookie = sid
    const res = await changePlanPOST(await apiRequest('POST', 'http://localhost/api/ecom/billing/change-plan', { body: { tenantId: crypto.randomUUID(), planSlug: 'x' } }) as any)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Tenant not found')
  })

  it('change-plan: 400 "No active subscription" for an owned tenant without a razorpay subscription', async () => {
    ownerSidCookie = sid
    const res = await changePlanPOST(await apiRequest('POST', 'http://localhost/api/ecom/billing/change-plan', { body: { tenantId, planSlug: 'anything' } }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('No active subscription found')
  })

  // ── messaging-addon GET/POST ─────────────────────────────────────────────
  it('messaging-addon: 401 (GET) without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await msgGET(await apiRequest('GET', u('/api/ecom/billing/messaging-addon')) as any)
    expect(res.status).toBe(401)
  })

  it('messaging-addon: 200 (GET) returns add-on state for the real tenant', async () => {
    ownerSidCookie = sid
    const res = await msgGET(await apiRequest('GET', u('/api/ecom/billing/messaging-addon')) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('tier') // 'none' until bought
    expect(body).toHaveProperty('priceInr')
    expect(body).toHaveProperty('balanceInr')
    expect(body).toHaveProperty('entitlement')
    expect(body.balanceInr).toBe(5000)
  })

  it('messaging-addon: 400 (POST) on an unknown action', async () => {
    ownerSidCookie = sid
    const res = await msgPOST(await apiRequest('POST', u('/api/ecom/billing/messaging-addon'), { body: { action: 'nope' } }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown action')
  })

  // NOTE: POST { action: 'buy' } for messaging is NOT asserted as a success. The real debit builds
  // externalRef `messaging_addon:<uuid>:both:<YYYY-MM-DD>` = 68 chars, but wallet_ledger.external_ref is
  // varchar(64), so the insert overflows and the route surfaces a 402. That is a production schema limit,
  // not a test setup issue, and fixing it would require a src/DDL change (out of scope). Ad-free's shorter
  // ref (`ad_free:<uuid>:<date>` = 55) fits, so the buy side-effect is proven there instead.

  it('messaging-addon: 200 (POST renew_off) flips the renew flag on the real row (no debit)', async () => {
    ownerSidCookie = sid
    const res = await msgPOST(await apiRequest('POST', u('/api/ecom/billing/messaging-addon'), { body: { action: 'renew_off' } }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).renew).toBe(false)
    const t = (await cp.query(`SELECT messaging_addon_renew FROM tenants WHERE id=$1`, [tenantId])).rows[0]
    expect(t.messaging_addon_renew).toBe(false)
  })

  // ── ad-free GET/POST ──────────────────────────────────────────────────────
  it('ad-free: 401 (GET) without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await adFreeGET(await apiRequest('GET', u('/api/ecom/billing/ad-free')) as any)
    expect(res.status).toBe(401)
  })

  it('ad-free: 200 (GET) returns ad-free state for the real tenant', async () => {
    ownerSidCookie = sid
    const res = await adFreeGET(await apiRequest('GET', u('/api/ecom/billing/ad-free')) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('active')
    expect(body).toHaveProperty('priceInr')
    expect(body).toHaveProperty('balanceInr')
  })

  it('ad-free: 400 (POST) on an unknown action', async () => {
    ownerSidCookie = sid
    const res = await adFreePOST(await apiRequest('POST', u('/api/ecom/billing/ad-free'), { body: { action: 'nope' } }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown action')
  })

  it('ad-free: 200 (POST buy) debits the wallet and extends ad_free_until', async () => {
    ownerSidCookie = sid
    const res = await adFreePOST(await apiRequest('POST', u('/api/ecom/billing/ad-free'), { body: { action: 'buy' } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.active).toBe(true)
    const t = (await cp.query(`SELECT ad_free_until FROM tenants WHERE id=$1`, [tenantId])).rows[0]
    expect(t.ad_free_until).toBeTruthy()
    const led = await cp.query(`SELECT 1 FROM wallet_ledger WHERE tenant_id=$1 AND category='ad_free'`, [tenantId])
    expect(led.rowCount).toBeGreaterThan(0)
  })
})
