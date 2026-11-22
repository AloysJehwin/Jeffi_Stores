// @vitest-environment node
//
// DB-backed API tests (jeffi_test) — controller ecom onboarding slice. These routes gate via
// ownerApi/resolveOwnerSession, which reads the owner_sid cookie through next/headers cookies()
// (request-scoped — THROWS when the handler is called directly), so we mock ONLY next/headers to feed
// the cookie; the session sid is REAL (issueOwnerSession) and every registry call runs its real SQL
// against jeffi_test. Covered: draft (GET/POST), pincode (GET), restore-available (GET), services (POST).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb } from '../../../packages/store-core/integration-tests/db/harness'
import { makeOwnerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// Mutable cookie value the mocked cookies() store returns (set per test).
let ownerSidCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => (name === 'owner_sid' && ownerSidCookie ? { value: ownerSidCookie } : undefined),
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

describe.skipIf(!API_DB_ENABLED)('controller ecom onboarding API (real DB, owner session)', () => {
  let db: typeof import('@/lib/shared/db')
  let cp: any
  let sid = ''
  let ownerId = ''
  // A separate owner that already owns a tenant, for the "you already have ..." branches.
  let sid2 = ''
  let ownerId2 = ''
  const tenantId2 = crypto.randomUUID()
  const slug2 = 'apitest-onb-' + crypto.randomBytes(3).toString('hex')
  const email = `apitest-onb-${crypto.randomBytes(3).toString('hex')}@jeffi.test`
  const email2 = `apitest-onb2-${crypto.randomBytes(3).toString('hex')}@jeffi.test`
  // Tenants the services POST happy path creates (cleaned up by owner id below).
  let createdPlan = false

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const ownerSession = await import('@/lib/auth/owner-session')
    const reg = await import('@/lib/tenant-registry')
    cp = reg.controlPlanePool()
    ;({ sid, owner: { id: ownerId } } = await makeOwnerSession(ownerSession, email))
    ;({ sid: sid2, owner: { id: ownerId2 } } = await makeOwnerSession(ownerSession, email2))
    // owner2 already has a (store) tenant → trips the one-store / one-workspace guards.
    await cp.query(
      `INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1,$2,'API Onb Existing','active','{store}'::text[]) ON CONFLICT (id) DO NOTHING`,
      [tenantId2, slug2]
    )
    await cp.query(`INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [ownerId2, tenantId2])
    // The services route creates tenants on the free 'services' plan, looked up by slug. Seed it if absent;
    // only delete it in cleanup when we created it (don't drop a real seed).
    const pre = await cp.query(`SELECT 1 FROM plans WHERE slug='services'`)
    if (!pre.rows[0]) {
      await cp.query(`INSERT INTO plans (slug, name, tier, product, is_active) VALUES ('services','Services',0,'services',true) ON CONFLICT (slug) DO NOTHING`)
      createdPlan = true
    }
  })

  afterAll(async () => {
    // Tenants created for owner1 by the services POST (and their FK children), via the owner link.
    const owned = await cp.query(`SELECT tenant_id FROM owner_tenants WHERE owner_id = ANY($1::uuid[])`, [[ownerId]])
    const ids = owned.rows.map((r: any) => r.tenant_id)
    for (const t of ['messaging_tenant_settings', 'tenant_service_approvals', 'wallet_ledger', 'tenant_wallets', 'tenant_infra', 'tenant_kyc']) {
      if (ids.length) await cp.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1::uuid[])`, [ids]).catch(() => {})
    }
    await cp.query(`DELETE FROM owner_tenants WHERE owner_id = ANY($1::uuid[])`, [[ownerId, ownerId2]]).catch(() => {})
    if (ids.length) await cp.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [ids]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id=$1`, [tenantId2]).catch(() => {})
    await cp.query(`DELETE FROM onboarding_drafts WHERE owner_id = ANY($1::uuid[])`, [[ownerId, ownerId2]]).catch(() => {})
    await cp.query(`DELETE FROM tenant_archives WHERE owner_id = ANY($1::uuid[])`, [[ownerId, ownerId2]]).catch(() => {})
    if (createdPlan) await cp.query(`DELETE FROM plans WHERE slug='services'`).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = ANY($1::uuid[]) AND principal_type='owner'`, [[ownerId, ownerId2]]).catch(() => {})
    await cp.query(`DELETE FROM owners WHERE id = ANY($1::uuid[])`, [[ownerId, ownerId2]]).catch(() => {})
    await endPool()
  })

  describe('draft (GET/POST)', () => {
    let GET: (req: any) => Promise<Response>
    let POST: (req: any) => Promise<Response>
    beforeAll(async () => {
      const route = await import('@controller/app/api/(ecom)/ecom/onboard/draft/route')
      GET = route.GET as any
      POST = route.POST as any
    })

    it('GET 401 without an owner session', async () => {
      ownerSidCookie = undefined
      const res = await GET(await apiRequest('GET', 'http://localhost/api/ecom/onboard/draft') as any)
      expect(res.status).toBe(401)
    })

    it('GET 200 { draft: null } when the owner has no draft', async () => {
      ownerSidCookie = sid
      const res = await GET(await apiRequest('GET', 'http://localhost/api/ecom/onboard/draft') as any)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ draft: null })
    })

    it('POST 401 without an owner session', async () => {
      ownerSidCookie = undefined
      const res = await POST(await apiRequest('POST', 'http://localhost/api/ecom/onboard/draft', { body: { step: 0, data: {} } }) as any)
      expect(res.status).toBe(401)
    })

    it('POST 400 on invalid payload (step out of range)', async () => {
      ownerSidCookie = sid
      const res = await POST(await apiRequest('POST', 'http://localhost/api/ecom/onboard/draft', { body: { step: 9999, data: {} } }) as any)
      expect(res.status).toBe(400)
    })

    it('POST 400 on non-JSON body', async () => {
      ownerSidCookie = sid
      const { NextRequest } = await import('next/server')
      const req = new NextRequest('http://localhost/api/ecom/onboard/draft', { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } })
      const res = await POST(req as any)
      expect(res.status).toBe(400)
    })

    it('POST 200 writes the draft row, and GET reads it back (sanitising PAN)', async () => {
      ownerSidCookie = sid
      const res = await POST(
        await apiRequest('POST', 'http://localhost/api/ecom/onboard/draft', {
          // 'pan' is sanitised: a valid PAN is kept uppercased, a bad one blanked.
          body: { step: 1, data: { displayName: 'Draft Co', pan: 'abcpe1234f', gstNumber: 'not-a-gstin' } },
        }) as any
      )
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })

      // Real DB side-effect: the row exists with the step and sanitised data.
      const row = await cp.query(`SELECT current_step, status, data FROM onboarding_drafts WHERE owner_id=$1`, [ownerId])
      expect(row.rows).toHaveLength(1)
      expect(row.rows[0].current_step).toBe(1)
      expect(row.rows[0].status).toBe('draft')
      expect(row.rows[0].data.pan).toBe('ABCPE1234F') // valid → kept, uppercased
      expect(row.rows[0].data.gstNumber).toBe('') // invalid → blanked (not rejected)

      // And GET now returns it.
      const g = await GET(await apiRequest('GET', 'http://localhost/api/ecom/onboard/draft') as any)
      const body = await g.json()
      expect(body.draft).not.toBeNull()
      expect(body.draft.current_step).toBe(1)
      expect(body.draft.data.displayName).toBe('Draft Co')
    })
  })

  describe('pincode (GET)', () => {
    let GET: (req: any) => Promise<Response>
    beforeAll(async () => {
      GET = (await import('@controller/app/api/(ecom)/ecom/onboard/pincode/route')).GET as any
    })

    it('401 without an owner session', async () => {
      ownerSidCookie = undefined
      const res = await GET(await apiRequest('GET', 'http://localhost/api/ecom/onboard/pincode?pin=560001') as any)
      expect(res.status).toBe(401)
    })

    it('200 { error: "A pincode is six digits." } for a non-6-digit pin (no external call)', async () => {
      ownerSidCookie = sid
      const res = await GET(await apiRequest('GET', 'http://localhost/api/ecom/onboard/pincode?pin=12') as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.serviceable).toBe(false)
      expect(body.error).toBe('A pincode is six digits.')
    })
    // A valid 6-digit pin is intentionally NOT asserted: with a Delhivery token resolvable from env the
    // route makes a live call to track.delhivery.com, whose outcome is non-deterministic in CI. Only the
    // auth gate and the offline input-validation branch are covered here.
  })

  describe('restore-available (GET)', () => {
    let GET: (req: any) => Promise<Response>
    beforeAll(async () => {
      GET = (await import('@controller/app/api/(ecom)/ecom/onboard/restore-available/route')).GET as any
    })

    it('401 without an owner session', async () => {
      ownerSidCookie = undefined
      const res = await GET(await apiRequest('GET', 'http://localhost/api/ecom/onboard/restore-available') as any)
      expect(res.status).toBe(401)
    })

    it('200 available:true from a seeded owner archive (DB path, no S3)', async () => {
      // Seed an available archive for the owner → findOwnerArchive returns it and the handler never
      // reaches the S3-backed findLatestBackup fallback.
      const archiveId = crypto.randomUUID()
      await cp.query(
        `INSERT INTO tenant_archives (id, owner_id, slug, display_name, keep_database, keep_media, keep_config, media_objects, media_bytes, retention_days, expires_at, status)
         VALUES ($1,$2,$3,'Archived Store',true,true,false,7,12345,30, now() + interval '10 days','available')`,
        [archiveId, ownerId, 'apitest-arch-' + crypto.randomBytes(3).toString('hex')]
      )
      ownerSidCookie = sid
      const res = await GET(await apiRequest('GET', 'http://localhost/api/ecom/onboard/restore-available') as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.available).toBe(true)
      expect(body.archive.id).toBe(archiveId)
      expect(body.archive.database).toBe(true)
      expect(body.archive.media).toBe(true)
      expect(body.archive.config).toBe(false)
      expect(body.archive.mediaObjects).toBe(7)
      expect(body.archive.mediaBytes).toBe(12345)
    })
  })

  describe('services (POST)', () => {
    let POST: (req: any) => Promise<Response>
    beforeAll(async () => {
      POST = (await import('@controller/app/api/(ecom)/ecom/onboard/services/route')).POST as any
    })

    // A valid services payload: proprietor PAN (4th letter P), no GSTIN (optional), a known state.
    const validBody = (slug: string) => ({
      services: ['messaging'],
      slug,
      displayName: 'API Services Co',
      businessName: 'API Services Private Co',
      entityType: 'proprietor',
      addressLine: '12 Market Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
      authorizedName: 'Asha Rao',
      authorizedDesignation: 'Proprietor',
      pan: 'ABCPE1234F',
      ownerName: 'Asha Rao',
      mobile: '+919900000000',
      legalsAccepted: true,
    })

    it('401 without an owner session', async () => {
      ownerSidCookie = undefined
      const res = await POST(await apiRequest('POST', 'http://localhost/api/ecom/onboard/services', { body: validBody('apitest-svc-a') }) as any)
      expect(res.status).toBe(401)
    })

    it('400 when the owner already has a workspace', async () => {
      ownerSidCookie = sid2 // owner2 already owns tenantId2
      const res = await POST(await apiRequest('POST', 'http://localhost/api/ecom/onboard/services', { body: validBody('apitest-svc-b') }) as any)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('You already have a workspace.')
    })

    it('400 on an invalid payload (bad PAN shape)', async () => {
      ownerSidCookie = sid
      const res = await POST(await apiRequest('POST', 'http://localhost/api/ecom/onboard/services', { body: { ...validBody('apitest-svc-c'), pan: 'BADPAN' } }) as any)
      expect(res.status).toBe(400)
    })

    it('200 creates an active services tenant with a KYC row, messaging review flag and service approval', async () => {
      ownerSidCookie = sid
      const slug = 'apitest-svc-' + crypto.randomBytes(3).toString('hex')
      const res = await POST(await apiRequest('POST', 'http://localhost/api/ecom/onboard/services', { body: validBody(slug) }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.slug).toBe(slug)
      const tenantId = body.tenantId
      expect(tenantId).toBeTruthy()

      // Real DB side-effects.
      const t = await cp.query(`SELECT status, service_types FROM tenants WHERE id=$1`, [tenantId])
      expect(t.rows[0].status).toBe('active')
      expect(t.rows[0].service_types).toContain('messaging')

      const link = await cp.query(`SELECT 1 FROM owner_tenants WHERE owner_id=$1 AND tenant_id=$2`, [ownerId, tenantId])
      expect(link.rows).toHaveLength(1)

      const kyc = await cp.query(`SELECT pan, business_name FROM tenant_kyc WHERE tenant_id=$1`, [tenantId])
      expect(kyc.rows[0].pan).toBe('ABCPE1234F')
      expect(kyc.rows[0].business_name).toBe('API Services Private Co')

      const msg = await cp.query(`SELECT review_required FROM messaging_tenant_settings WHERE tenant_id=$1`, [tenantId])
      expect(msg.rows[0].review_required).toBe(true)

      const appr = await cp.query(`SELECT 1 FROM tenant_service_approvals WHERE tenant_id=$1`, [tenantId])
      expect(appr.rows.length).toBeGreaterThan(0)
    })
  })
})
