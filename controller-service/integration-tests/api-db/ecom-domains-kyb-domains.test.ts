// @vitest-environment node
//
// DB-backed API tests (jeffi_test) — controller ecom DOMAINS slice. These routes gate on the owner
// session via next/headers cookies() (request-scoped), so we mock ONLY next/headers with a mutable
// cookie var and keep the session sid REAL (issueOwnerSession → auth_sessions). Assertions hit the
// real control-plane tables (tenant_custom_domains, tenants, plans).
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

describe.skipIf(!API_DB_ENABLED)('controller ecom domains API (real DB, owner session)', () => {
  let cp: any
  let db: typeof import('@/lib/shared/db')
  let listR: any, byIdR: any, verifyR: any, searchR: any
  let sid = ''
  let ownerId = ''
  const planId = crypto.randomUUID()
  const tenantId = crypto.randomUUID()
  const slug = 'apitest-dom-' + crypto.randomBytes(3).toString('hex')
  const email = `apitest-dom-${crypto.randomBytes(3).toString('hex')}@jeffi.test`

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const ownerSession = await import('@/lib/auth/owner-session')
    const reg = await import('@/lib/tenant-registry')
    cp = reg.controlPlanePool()
    listR = await import('@controller/app/api/(ecom)/ecom/domains/route')
    byIdR = await import('@controller/app/api/(ecom)/ecom/domains/[id]/route')
    verifyR = await import('@controller/app/api/(ecom)/ecom/domains/[id]/verify/route')
    searchR = await import('@controller/app/api/(ecom)/ecom/domains/search/route')
    ;({ sid, owner: { id: ownerId } } = await makeOwnerSession(ownerSession, email))
    // A Pro-ish plan with a custom-domain quota so addCustomDomain is allowed.
    await cp.query(
      `INSERT INTO plans (id, slug, name, tier, max_custom_domains, is_active) VALUES ($1,$2,'API Test Plan',5,3,true) ON CONFLICT (id) DO NOTHING`,
      [planId, 'apitest-plan-' + crypto.randomBytes(3).toString('hex')]
    )
    await cp.query(
      `INSERT INTO tenants (id, slug, display_name, status, service_types, plan_id) VALUES ($1,$2,'API Test Domains Store','active','{store}'::text[],$3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, slug, planId]
    )
    await cp.query(`INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ownerId, tenantId])
  })

  afterAll(async () => {
    await cp.query(`DELETE FROM tenant_custom_domains WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM owner_tenants WHERE owner_id=$1`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM plans WHERE id=$1`, [planId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='owner'`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM owners WHERE id=$1`, [ownerId]).catch(() => {})
    await endPool()
  })

  // ── GET /api/ecom/domains ──────────────────────────────────────────────────
  it('domains list: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await listR.GET(await apiRequest('GET', `http://localhost/api/ecom/domains?tenantId=${tenantId}`) as any)
    expect(res.status).toBe(401)
  })

  it('domains list: 400 without tenantId', async () => {
    ownerSidCookie = sid
    const res = await listR.GET(await apiRequest('GET', `http://localhost/api/ecom/domains`) as any)
    expect(res.status).toBe(400)
  })

  it('domains list: 404 for a tenant the owner does not own', async () => {
    ownerSidCookie = sid
    const res = await listR.GET(await apiRequest('GET', `http://localhost/api/ecom/domains?tenantId=${crypto.randomUUID()}`) as any)
    expect(res.status).toBe(404)
  })

  it('domains list: 200 returns the DNS targets and an (initially empty) domains array', async () => {
    ownerSidCookie = sid
    const res = await listR.GET(await apiRequest('GET', `http://localhost/api/ecom/domains?tenantId=${tenantId}`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.domains)).toBe(true)
    expect(body.cnameTarget).toContain(slug)
  })

  // ── POST /api/ecom/domains (add) ────────────────────────────────────────────
  it('domains add: 400 on an invalid payload (missing domain)', async () => {
    ownerSidCookie = sid
    const res = await listR.POST(await apiRequest('POST', `http://localhost/api/ecom/domains`, { body: { tenantId } }) as any)
    expect(res.status).toBe(400)
  })

  it('domains add: 200 writes a pending tenant_custom_domains row (real DB side-effect)', async () => {
    ownerSidCookie = sid
    const domain = `shop-${crypto.randomBytes(3).toString('hex')}.example.com`
    const res = await listR.POST(await apiRequest('POST', `http://localhost/api/ecom/domains`, { body: { tenantId, domain } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.domain.domain).toBe(domain)
    const row = await cp.query(`SELECT status, verification_token FROM tenant_custom_domains WHERE tenant_id=$1 AND domain=$2`, [tenantId, domain])
    expect(row.rows[0]?.status).toBe('pending')
    expect(row.rows[0]?.verification_token).toBeTruthy()
  })

  // ── GET/DELETE /api/ecom/domains/[id] ───────────────────────────────────────
  it('domains [id] GET: 200 for the owner, 401 unauthenticated, 404 for an unknown id', async () => {
    const domain = `www-${crypto.randomBytes(3).toString('hex')}.example.com`
    const added = await cp.query(
      `INSERT INTO tenant_custom_domains (tenant_id, domain, status, verification_token) VALUES ($1,$2,'pending','tok') RETURNING id`,
      [tenantId, domain]
    )
    const id = added.rows[0].id

    ownerSidCookie = undefined
    expect((await byIdR.GET(await apiRequest('GET', `http://localhost/api/ecom/domains/${id}`) as any, { params: Promise.resolve({ id }) })).status).toBe(401)

    ownerSidCookie = sid
    const ok = await byIdR.GET(await apiRequest('GET', `http://localhost/api/ecom/domains/${id}`) as any, { params: Promise.resolve({ id }) })
    expect(ok.status).toBe(200)
    expect((await ok.json()).domain.domain).toBe(domain)

    const miss = await byIdR.GET(await apiRequest('GET', `http://localhost/api/ecom/domains/${crypto.randomUUID()}`) as any, { params: Promise.resolve({ id: crypto.randomUUID() }) })
    expect(miss.status).toBe(404)
  })

  it('domains [id] DELETE: 200 removes the row (real DB side-effect)', async () => {
    const domain = `del-${crypto.randomBytes(3).toString('hex')}.example.com`
    const added = await cp.query(
      `INSERT INTO tenant_custom_domains (tenant_id, domain, status, verification_token) VALUES ($1,$2,'pending','tok') RETURNING id`,
      [tenantId, domain]
    )
    const id = added.rows[0].id
    ownerSidCookie = sid
    const res = await byIdR.DELETE(await apiRequest('DELETE', `http://localhost/api/ecom/domains/${id}`) as any, { params: Promise.resolve({ id }) })
    expect(res.status).toBe(200)
    const gone = await cp.query(`SELECT id FROM tenant_custom_domains WHERE id=$1`, [id])
    expect(gone.rowCount).toBe(0)
  })

  it('domains [id] DELETE: 403 when the domain belongs to another owner’s tenant', async () => {
    const otherTenant = crypto.randomUUID()
    await cp.query(`INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1,$2,'Other','active','{store}'::text[]) ON CONFLICT DO NOTHING`, [otherTenant, 'apitest-other-' + crypto.randomBytes(3).toString('hex')])
    const added = await cp.query(
      `INSERT INTO tenant_custom_domains (tenant_id, domain, status, verification_token) VALUES ($1,$2,'pending','tok') RETURNING id`,
      [otherTenant, `foe-${crypto.randomBytes(3).toString('hex')}.example.com`]
    )
    const id = added.rows[0].id
    ownerSidCookie = sid
    const res = await byIdR.DELETE(await apiRequest('DELETE', `http://localhost/api/ecom/domains/${id}`) as any, { params: Promise.resolve({ id }) })
    expect(res.status).toBe(403)
    await cp.query(`DELETE FROM tenant_custom_domains WHERE id=$1`, [id]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id=$1`, [otherTenant]).catch(() => {})
  })

  // ── POST /api/ecom/domains/[id]/verify ──────────────────────────────────────
  it('domains verify: 401 unauthenticated, 404 for an unknown id', async () => {
    ownerSidCookie = undefined
    const id = crypto.randomUUID()
    expect((await verifyR.POST(await apiRequest('POST', `http://localhost/api/ecom/domains/${id}/verify`) as any, { params: Promise.resolve({ id }) })).status).toBe(401)
    ownerSidCookie = sid
    expect((await verifyR.POST(await apiRequest('POST', `http://localhost/api/ecom/domains/${id}/verify`) as any, { params: Promise.resolve({ id }) })).status).toBe(404)
  })

  // ── GET /api/ecom/domains/search ────────────────────────────────────────────
  it('domains search: 401 unauthenticated', async () => {
    ownerSidCookie = undefined
    const res = await searchR.GET(await apiRequest('GET', `http://localhost/api/ecom/domains/search?q=mystore`) as any)
    expect(res.status).toBe(401)
  })

  it('domains search: 200 with empty results for a <2-char query (no provider call)', async () => {
    ownerSidCookie = sid
    const res = await searchR.GET(await apiRequest('GET', `http://localhost/api/ecom/domains/search?q=a`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toEqual([])
    expect(body.suggestions).toEqual([])
  })
})
