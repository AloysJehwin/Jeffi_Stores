// @vitest-environment node
//
// DB-backed API tests (jeffi_test) — controller ecom BANK / COMPLIANCE / SHOWCASE slice. Owner session
// via mocked next/headers cookies(); session sid is REAL. Assertions hit tenant_bank_accounts,
// tenant_compliance_documents and showcase_sites/leads. Routes needing S3 or a live registrar are
// exercised only on their auth/validation branches (noted inline).
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

describe.skipIf(!API_DB_ENABLED)('controller ecom bank/compliance/showcase API (real DB, owner session)', () => {
  let cp: any
  let db: typeof import('@/lib/shared/db')
  let bankVerifyR: any, bankUpiR: any, complianceDocR: any, showcaseHostingR: any, showcaseLeadsR: any
  let sid = ''
  let ownerId = ''
  const tenantId = crypto.randomUUID()
  const slug = 'apitest-bcs-' + crypto.randomBytes(3).toString('hex')
  const email = `apitest-bcs-${crypto.randomBytes(3).toString('hex')}@jeffi.test`
  // The Showcase routes are per site: /api/ecom/showcase/[siteId]/…
  const siteId = crypto.randomUUID()
  const site = () => ({ params: Promise.resolve({ siteId }) })

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const ownerSession = await import('@/lib/auth/owner-session')
    const reg = await import('@/lib/tenant-registry')
    cp = reg.controlPlanePool()
    bankVerifyR = await import('@controller/app/api/(ecom)/ecom/bank/verify/route')
    bankUpiR = await import('@controller/app/api/(ecom)/ecom/bank/upi/route')
    complianceDocR = await import('@controller/app/api/(ecom)/ecom/compliance/[docId]/route')
    showcaseHostingR = await import('@controller/app/api/(ecom)/ecom/showcase/[siteId]/hosting/route')
    showcaseLeadsR = await import('@controller/app/api/(ecom)/ecom/showcase/[siteId]/leads/route')
    ;({ sid, owner: { id: ownerId } } = await makeOwnerSession(ownerSession, email))
    await cp.query(
      `INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1,$2,'API Test BCS Store','active','{store}'::text[]) ON CONFLICT (id) DO NOTHING`,
      [tenantId, slug]
    )
    await cp.query(`INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ownerId, tenantId])
  })

  afterAll(async () => {
    await cp.query(`DELETE FROM tenant_bank_accounts WHERE owner_id=$1`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM showcase_sites WHERE owner_id=$1`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM owner_tenants WHERE owner_id=$1`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='owner'`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM owners WHERE id=$1`, [ownerId]).catch(() => {})
    await endPool()
  })

  // ── POST /api/ecom/bank/verify ──────────────────────────────────────────────
  it('bank verify: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await bankVerifyR.POST(await apiRequest('POST', `http://localhost/api/ecom/bank/verify`, { body: { accountNumber: '123456789', ifsc: 'HDFC0001234', holderName: 'A' } }) as any)
    expect(res.status).toBe(401)
  })

  it('bank verify: 400 on a malformed IFSC', async () => {
    ownerSidCookie = sid
    const res = await bankVerifyR.POST(await apiRequest('POST', `http://localhost/api/ecom/bank/verify`, { body: { accountNumber: '123456789', ifsc: 'BADIFSC0001', holderName: 'Acme' } }) as any)
    expect(res.status).toBe(400)
  })

  it('bank verify: 200 records an unverified bank row (real DB side-effect; no linked account → no Route push)', async () => {
    ownerSidCookie = sid
    const res = await bankVerifyR.POST(
      await apiRequest('POST', `http://localhost/api/ecom/bank/verify`, {
        body: { accountNumber: '000111222333', ifsc: 'HDFC0001234', holderName: 'Acme Test Traders' },
      }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('unverified')
    expect(body.pushedToRoute).toBe(false)
    const row = await cp.query(`SELECT account_number, ifsc, verification_status FROM tenant_bank_accounts WHERE owner_id=$1`, [ownerId])
    expect(row.rows[0]?.ifsc).toBe('HDFC0001234')
    expect(row.rows[0]?.verification_status).toBe('unverified')
  })

  // ── PATCH /api/ecom/bank/upi ────────────────────────────────────────────────
  it('bank upi: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await bankUpiR.PATCH(await apiRequest('PATCH', `http://localhost/api/ecom/bank/upi`, { body: { upiId: 'acme@okhdfc' } }) as any)
    expect(res.status).toBe(401)
  })

  it('bank upi: 400 on a malformed UPI id', async () => {
    ownerSidCookie = sid
    const res = await bankUpiR.PATCH(await apiRequest('PATCH', `http://localhost/api/ecom/bank/upi`, { body: { upiId: 'not-a-upi' } }) as any)
    expect(res.status).toBe(400)
  })

  it('bank upi: 200 updates upi_id on the owner’s bank row (real DB side-effect)', async () => {
    // depends on the bank row written by the verify test above
    ownerSidCookie = sid
    const res = await bankUpiR.PATCH(await apiRequest('PATCH', `http://localhost/api/ecom/bank/upi`, { body: { upiId: 'acme@okhdfc' } }) as any)
    expect(res.status).toBe(200)
    expect((await res.json()).upiId).toBe('acme@okhdfc')
    const row = await cp.query(`SELECT upi_id FROM tenant_bank_accounts WHERE owner_id=$1`, [ownerId])
    expect(row.rows[0]?.upi_id).toBe('acme@okhdfc')
  })

  it('bank upi: 409 when the owner has no bank row yet', async () => {
    // A fresh owner with no settlement account.
    const ownerSession = await import('@/lib/auth/owner-session')
    const other = await makeOwnerSession(ownerSession, `apitest-nobank-${crypto.randomBytes(3).toString('hex')}@jeffi.test`)
    ownerSidCookie = other.sid
    const res = await bankUpiR.PATCH(await apiRequest('PATCH', `http://localhost/api/ecom/bank/upi`, { body: { upiId: 'nobody@okhdfc' } }) as any)
    expect(res.status).toBe(409)
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='owner'`, [other.owner.id]).catch(() => {})
    await cp.query(`DELETE FROM owners WHERE id=$1`, [other.owner.id]).catch(() => {})
  })

  // ── GET /api/ecom/compliance/[docId] ────────────────────────────────────────
  // The 200 path streams the file from S3 (external) — not seedable here. Auth + not-found are.
  it('compliance [docId] GET: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const id = crypto.randomUUID()
    const res = await complianceDocR.GET(await apiRequest('GET', `http://localhost/api/ecom/compliance/${id}`) as any, { params: Promise.resolve({ docId: id }) })
    expect(res.status).toBe(401)
  })

  it('compliance [docId] GET: 404 for a document the owner does not have on file', async () => {
    ownerSidCookie = sid
    const id = crypto.randomUUID()
    const res = await complianceDocR.GET(await apiRequest('GET', `http://localhost/api/ecom/compliance/${id}`) as any, { params: Promise.resolve({ docId: id }) })
    expect(res.status).toBe(404)
  })

  // ── GET/POST /api/ecom/showcase/[siteId]/hosting ────────────────────────────
  it('showcase hosting GET: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await showcaseHostingR.GET(await apiRequest('GET', `http://localhost/api/ecom/showcase/${siteId}/hosting?tenant=${slug}`) as any, site())
    expect(res.status).toBe(401)
  })

  it('showcase hosting GET: 404 for a site that is not the owner’s', async () => {
    ownerSidCookie = sid
    const res = await showcaseHostingR.GET(await apiRequest('GET', `http://localhost/api/ecom/showcase/${siteId}/hosting?tenant=${slug}`) as any, site())
    expect(res.status).toBe(404)
  })

  it('showcase hosting POST: 400 on an unknown action', async () => {
    ownerSidCookie = sid
    const res = await showcaseHostingR.POST(await apiRequest('POST', `http://localhost/api/ecom/showcase/${siteId}/hosting?tenant=${slug}`, { body: { action: 'explode' } }) as any, site())
    expect(res.status).toBe(400)
  })

  it('showcase hosting GET: 200 with the console state once a site exists (real DB side-effect read)', async () => {
    const siteSlug = 'apitest-sc-' + crypto.randomBytes(3).toString('hex')
    await cp.query(
      `INSERT INTO showcase_sites (id, tenant_id, owner_id, slug, status, business) VALUES ($4,$1,$2,$3,'draft','{"name":"Acme Showcase"}'::jsonb)`,
      [tenantId, ownerId, siteSlug, siteId]
    )
    ownerSidCookie = sid
    const res = await showcaseHostingR.GET(await apiRequest('GET', `http://localhost/api/ecom/showcase/${siteId}/hosting?tenant=${slug}`) as any, site())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.slug).toBe(siteSlug)
    expect(body.status).toBe('draft')
  })

  // ── GET/POST /api/ecom/showcase/[siteId]/leads ──────────────────────────────
  it('showcase leads GET: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await showcaseLeadsR.GET(await apiRequest('GET', `http://localhost/api/ecom/showcase/${siteId}/leads?tenant=${slug}`) as any, site())
    expect(res.status).toBe(401)
  })

  it('showcase leads GET: 200 lists the site’s leads, newest first (real DB side-effect read)', async () => {
    // relies on the site inserted by the hosting GET test
    await cp.query(`INSERT INTO showcase_leads (site_id, name, email, message) VALUES ($1,'Lead One','l1@x.test','hi')`, [siteId])
    ownerSidCookie = sid
    const res = await showcaseLeadsR.GET(await apiRequest('GET', `http://localhost/api/ecom/showcase/${siteId}/leads?tenant=${slug}`) as any, site())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pageSize).toBe(50)
    expect(Array.isArray(body.leads)).toBe(true)
    expect(body.leads.some((l: any) => l.name === 'Lead One')).toBe(true)
  })

  it('showcase leads POST: 400 on a bad payload (no ids)', async () => {
    ownerSidCookie = sid
    const res = await showcaseLeadsR.POST(await apiRequest('POST', `http://localhost/api/ecom/showcase/${siteId}/leads?tenant=${slug}`, { body: { action: 'read' } }) as any, site())
    expect(res.status).toBe(400)
  })

  it('showcase leads POST: 200 marks all read (real DB side-effect)', async () => {
    ownerSidCookie = sid
    const res = await showcaseLeadsR.POST(await apiRequest('POST', `http://localhost/api/ecom/showcase/${siteId}/leads?tenant=${slug}`, { body: { action: 'read', ids: 'all' } }) as any, site())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const unread = await cp.query(`SELECT COUNT(*)::int AS n FROM showcase_leads WHERE site_id=$1 AND read_at IS NULL`, [siteId])
    expect(unread.rows[0].n).toBe(0)
  })
})
