// @vitest-environment node
//
// DB-backed API tests (jeffi_test) — controller ecom compute slice: catalog (GET), quote (POST), compute (PUT).
// These routes gate via resolveOwnerSession reading the owner_sid cookie through next/headers cookies()
// (request-scoped, THROWS when the handler is called directly), so we mock ONLY next/headers to feed the
// cookie — the session sid is REAL (issueOwnerSession) and the handlers' SQL runs against jeffi_test.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb } from '../../../packages/store-core/integration-tests/db/harness'
import { makeOwnerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'
import { PRESETS } from '@/lib/compute/presets'

let ownerSidCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => (name === 'owner_sid' && ownerSidCookie ? { value: ownerSidCookie } : undefined),
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

describe.skipIf(!API_DB_ENABLED)('controller ecom compute API (real DB, owner session)', () => {
  let catalogGET: (req: any) => Promise<Response>
  let quotePOST: (req: any) => Promise<Response>
  let computePUT: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let cp: any
  let sid = ''
  let ownerId = ''
  const tenantId = crypto.randomUUID()
  const slug = 'apitest-ecom-cmp-' + crypto.randomBytes(3).toString('hex')
  const planSlug = 'apitest-plan-' + crypto.randomBytes(3).toString('hex')
  const email = `apitest-owner-${crypto.randomBytes(3).toString('hex')}@jeffi.test`
  // A minimal valid spec. 'small' preset: dedicated t4g.small, on-node DB.
  const spec = PRESETS.small.spec

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const ownerSession = await import('@/lib/auth/owner-session')
    const reg = await import('@/lib/tenant-registry')
    cp = reg.controlPlanePool()
    catalogGET = (await import('@controller/app/api/(ecom)/ecom/compute/catalog/route')).GET as any
    quotePOST = (await import('@controller/app/api/(ecom)/ecom/compute/quote/route')).POST as any
    computePUT = (await import('@controller/app/api/(ecom)/ecom/compute/route')).PUT as any
    ;({ sid, owner: { id: ownerId } } = await makeOwnerSession(ownerSession, email))

    // A plan the quote/PUT routes can look up (plans.product='store'). t4g.small fits a dedicated spec.
    await cp.query(
      `INSERT INTO plans (slug, name, tier, monthly_price_inr, product, min_preset, default_preset, min_placement, advanced_compute, is_active)
       VALUES ($1,'API Test Plan',1,499,'store','small','small','dedicated',true,true) ON CONFLICT (slug) DO NOTHING`,
      [planSlug]
    )
    // A matching ec2 price so quoteSpec can price the small preset (t4g.small = ec2:t4g.small).
    await cp.query(
      `INSERT INTO compute_prices (code, kind, label, vcpu, memory_mib, usd_hourly, sellable, sort)
       VALUES ('ec2:t4g.small','ec2','t4g.small',2,2048,0.0168,true,10) ON CONFLICT (code) DO NOTHING`
    )
    await cp.query(
      `INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1,$2,'API Test Ecom Store','active','{store}'::text[]) ON CONFLICT (id) DO NOTHING`,
      [tenantId, slug]
    )
    await cp.query(`INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ownerId, tenantId])
  })

  afterAll(async () => {
    await cp.query(`DELETE FROM tenant_compute WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM owner_tenants WHERE owner_id=$1`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM plans WHERE slug=$1`, [planSlug]).catch(() => {})
    await cp.query(`DELETE FROM compute_prices WHERE code='ec2:t4g.small'`).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='owner'`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM owners WHERE id=$1`, [ownerId]).catch(() => {})
    await endPool()
  })

  // ── catalog GET ──────────────────────────────────────────────────────────
  it('catalog: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await catalogGET(await apiRequest('GET', 'http://localhost/api/ecom/compute/catalog') as any)
    expect(res.status).toBe(401)
  })

  it('catalog: 200 returns catalog + plans read from the real DB (includes our seeded plan)', async () => {
    ownerSidCookie = sid
    const res = await catalogGET(await apiRequest('GET', 'http://localhost/api/ecom/compute/catalog') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('catalog')
    expect(body.catalog).toHaveProperty('prices')
    expect(body.catalog).toHaveProperty('settings')
    expect(Array.isArray(body.plans)).toBe(true)
    expect(body.plans.some((p: any) => p.slug === planSlug)).toBe(true)
  })

  // ── quote POST ───────────────────────────────────────────────────────────
  it('quote: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await quotePOST(await apiRequest('POST', 'http://localhost/api/ecom/compute/quote', { body: { planSlug, spec } }) as any)
    expect(res.status).toBe(401)
  })

  it('quote: 400 on an invalid body (spec missing)', async () => {
    ownerSidCookie = sid
    const res = await quotePOST(await apiRequest('POST', 'http://localhost/api/ecom/compute/quote', { body: { planSlug } }) as any)
    expect(res.status).toBe(400)
  })

  it('quote: 400 on an unknown plan', async () => {
    ownerSidCookie = sid
    const res = await quotePOST(await apiRequest('POST', 'http://localhost/api/ecom/compute/quote', { body: { planSlug: 'no-such-plan-xyz', spec } }) as any)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Unknown plan')
  })

  it('quote: 200 prices the seeded plan+spec against the real catalog', async () => {
    ownerSidCookie = sid
    const res = await quotePOST(await apiRequest('POST', 'http://localhost/api/ecom/compute/quote', { body: { planSlug, spec } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('preset')
    expect(body).toHaveProperty('validation')
    expect(body).toHaveProperty('quote')
    expect(body).toHaveProperty('total')
    expect(body).toHaveProperty('capacityError')
  })

  // ── compute PUT ──────────────────────────────────────────────────────────
  it('PUT: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await computePUT(await apiRequest('PUT', 'http://localhost/api/ecom/compute', { body: { tenantId, spec } }) as any)
    expect(res.status).toBe(401)
  })

  it('PUT: 400 on an invalid body (bad tenantId)', async () => {
    ownerSidCookie = sid
    const res = await computePUT(await apiRequest('PUT', 'http://localhost/api/ecom/compute', { body: { tenantId: 'not-a-uuid', spec } }) as any)
    expect(res.status).toBe(400)
  })

  it('PUT: 404 when the owner does not own the target tenant', async () => {
    ownerSidCookie = sid
    const res = await computePUT(await apiRequest('PUT', 'http://localhost/api/ecom/compute', { body: { tenantId: crypto.randomUUID(), spec } }) as any)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Store not found')
  })

  it('PUT: 403 when configurable compute is off (checkComputeChange gate), proving it reached the owned tenant', async () => {
    // COMPUTE_SPEC_ENABLED is unset in tests, so checkComputeChange short-circuits 403 after ownership passes.
    ownerSidCookie = sid
    const res = await computePUT(await apiRequest('PUT', 'http://localhost/api/ecom/compute', { body: { tenantId, spec } }) as any)
    expect(res.status).toBe(403)
    // Nothing was written to tenant_compute.
    const row = await cp.query(`SELECT 1 FROM tenant_compute WHERE tenant_id=$1`, [tenantId])
    expect(row.rowCount).toBe(0)
  })
})
