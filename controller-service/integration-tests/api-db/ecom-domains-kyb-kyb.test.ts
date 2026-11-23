// @vitest-environment node
//
// DB-backed API tests (jeffi_test) — controller ecom KYB slice. ownerApi reads the owner_sid via
// next/headers cookies() (request-scoped); we mock ONLY next/headers, session sid is REAL. The tenant
// is chosen by ?tenant=<slug>. Assertions hit tenant_kyc / tenant_compliance_documents.
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

describe.skipIf(!API_DB_ENABLED)('controller ecom KYB API (real DB, owner session)', () => {
  let cp: any
  let db: typeof import('@/lib/shared/db')
  let kybR: any, recheckR: any, docTypeR: any
  let sid = ''
  let ownerId = ''
  const tenantId = crypto.randomUUID()
  const slug = 'apitest-kyb-' + crypto.randomBytes(3).toString('hex')
  const email = `apitest-kyb-${crypto.randomBytes(3).toString('hex')}@jeffi.test`

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const ownerSession = await import('@/lib/auth/owner-session')
    const reg = await import('@/lib/tenant-registry')
    cp = reg.controlPlanePool()
    kybR = await import('@controller/app/api/(ecom)/ecom/kyb/route')
    recheckR = await import('@controller/app/api/(ecom)/ecom/kyb/recheck/route')
    docTypeR = await import('@controller/app/api/(ecom)/ecom/kyb/documents/[docType]/route')
    ;({ sid, owner: { id: ownerId } } = await makeOwnerSession(ownerSession, email))
    await cp.query(
      `INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1,$2,'API Test KYB Store','active','{store}'::text[]) ON CONFLICT (id) DO NOTHING`,
      [tenantId, slug]
    )
    await cp.query(`INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ownerId, tenantId])
  })

  afterAll(async () => {
    await cp.query(`DELETE FROM tenant_compliance_documents WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM tenant_kyc WHERE tenant_id=$1`, [tenantId]).catch(() => {})
    await cp.query(`DELETE FROM owner_tenants WHERE owner_id=$1`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='owner'`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM owners WHERE id=$1`, [ownerId]).catch(() => {})
    await endPool()
  })

  // ── GET /api/ecom/kyb ───────────────────────────────────────────────────────
  it('kyb GET: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await kybR.GET(await apiRequest('GET', `http://localhost/api/ecom/kyb?tenant=${slug}`) as any)
    expect(res.status).toBe(401)
  })

  it('kyb GET: 200 returns the KYB view shape (no record yet → null profile fields)', async () => {
    ownerSidCookie = sid
    const res = await kybR.GET(await apiRequest('GET', `http://localhost/api/ecom/kyb?tenant=${slug}`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kyb).toBeDefined()
    expect(body.kyb.tenantId).toBe(tenantId)
    expect(body.kyb).toHaveProperty('profile')
    expect(body.kyb).toHaveProperty('items')
    expect(body.kyb).toHaveProperty('services')
  })

  // ── PUT /api/ecom/kyb (save a section) ──────────────────────────────────────
  it('kyb PUT: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await kybR.PUT(await apiRequest('PUT', `http://localhost/api/ecom/kyb?tenant=${slug}`, { body: { legalName: 'Acme' } }) as any)
    expect(res.status).toBe(401)
  })

  it('kyb PUT: 400 on an invalid PAN', async () => {
    ownerSidCookie = sid
    const res = await kybR.PUT(await apiRequest('PUT', `http://localhost/api/ecom/kyb?tenant=${slug}`, { body: { pan: 'NOTAPAN' } }) as any)
    expect(res.status).toBe(400)
  })

  it('kyb PUT: 200 saves the profile fields to tenant_kyc (real DB side-effect)', async () => {
    ownerSidCookie = sid
    const res = await kybR.PUT(
      await apiRequest('PUT', `http://localhost/api/ecom/kyb?tenant=${slug}`, {
        body: { legalName: 'Acme Test Traders', addressLine: '12 Market Road', city: 'Chennai', state: 'Tamil Nadu', pincode: '600001' },
      }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kyb.profile.legalName).toBe('Acme Test Traders')
    const row = await cp.query(`SELECT business_name, address_city FROM tenant_kyc WHERE tenant_id=$1`, [tenantId])
    expect(row.rows[0]?.business_name).toBe('Acme Test Traders')
    expect(row.rows[0]?.address_city).toBe('Chennai')
  })

  // ── POST /api/ecom/kyb/recheck ──────────────────────────────────────────────
  it('kyb recheck: 401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await recheckR.POST(await apiRequest('POST', `http://localhost/api/ecom/kyb/recheck?tenant=${slug}`) as any)
    expect(res.status).toBe(401)
  })

  it('kyb recheck: 200 with a checking count (no docs → 0)', async () => {
    ownerSidCookie = sid
    const res = await recheckR.POST(await apiRequest('POST', `http://localhost/api/ecom/kyb/recheck?tenant=${slug}`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('checking')
    expect(body.kyb.tenantId).toBe(tenantId)
  })

  // ── PATCH/DELETE /api/ecom/kyb/documents/[docType] ──────────────────────────
  it('kyb documents [docType] PATCH: 400 for an unknown docType', async () => {
    ownerSidCookie = sid
    const res = await docTypeR.PATCH(
      await apiRequest('PATCH', `http://localhost/api/ecom/kyb/documents/not_a_doc?tenant=${slug}`, { body: { ownerNote: 'a reasonable note here' } }) as any,
      { params: Promise.resolve({ docType: 'not_a_doc' }) }
    )
    expect(res.status).toBe(400)
  })

  it('kyb documents [docType] PATCH: 404 when no such document is waiting', async () => {
    ownerSidCookie = sid
    const res = await docTypeR.PATCH(
      await apiRequest('PATCH', `http://localhost/api/ecom/kyb/documents/pan_card?tenant=${slug}`, { body: { ownerNote: 'name changed after marriage' } }) as any,
      { params: Promise.resolve({ docType: 'pan_card' }) }
    )
    expect(res.status).toBe(404)
  })

  it('kyb documents [docType] DELETE: 200 returns the refreshed view (no-op when none on file)', async () => {
    ownerSidCookie = sid
    const res = await docTypeR.DELETE(
      await apiRequest('DELETE', `http://localhost/api/ecom/kyb/documents/pan_card?tenant=${slug}`) as any,
      { params: Promise.resolve({ docType: 'pan_card' }) }
    )
    expect(res.status).toBe(200)
    expect((await res.json()).kyb.tenantId).toBe(tenantId)
  })

  it('kyb documents [docType] DELETE: 400 for an unknown docType', async () => {
    ownerSidCookie = sid
    const res = await docTypeR.DELETE(
      await apiRequest('DELETE', `http://localhost/api/ecom/kyb/documents/not_a_doc?tenant=${slug}`) as any,
      { params: Promise.resolve({ docType: 'not_a_doc' }) }
    )
    expect(res.status).toBe(400)
  })
})
