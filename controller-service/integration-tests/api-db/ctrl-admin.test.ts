// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — controller `(admin)/admin/ecom/*` route group.
// Every route here authenticates with requireAdminScope (real authenticateAdmin → resolveSession →
// hasScope against seeded admin sessions) and then gates on isPlatformAdmin(role). The control-plane
// pool falls back to DATABASE_URL (jeffi_test) when CONTROL_PLANE_DATABASE_URL is unset, so these hit
// the same jeffi_test Postgres and exercise the real control-plane queries + side effects.
//
// Covered: ecom/ai-pricing (GET/POST/PATCH), ecom/compute-pricing (GET/PATCH), ecom/message-pricing
// (GET), ecom/customers/overview (GET via the shared ecomOverviewGet gate).
// Scope/platform gate proven on every route: 401 (no session), 403 (admin session whose role isn't
// platform-admin even with the read scope), 200 (platform administrator). Plus validation + a real
// INSERT side-effect for ai-pricing.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('controller admin/ecom API — platform gate + real control-plane DB', () => {
  let db: typeof import('@/lib/shared/db')
  let aiPricing: typeof import('@controller/app/api/(admin)/admin/ecom/ai-pricing/route')
  let computePricing: typeof import('@controller/app/api/(admin)/admin/ecom/compute-pricing/route')
  let messagePricing: typeof import('@controller/app/api/(admin)/admin/ecom/message-pricing/route')
  let customersOverview: typeof import('@controller/app/api/(admin)/admin/ecom/customers/overview/route')
  // Full platform admin (role 'administrator' passes isPlatformAdmin + hasScope short-circuit) and a
  // non-platform admin who DOES hold the read scope but whose role is not platform-admin → must be 403.
  let fullSid = ''
  let narrowSid = ''
  // ai_price_list rows this file inserts, deleted in afterAll.
  const insertedPriceKeys: string[] = []

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    aiPricing = await import('@controller/app/api/(admin)/admin/ecom/ai-pricing/route')
    computePricing = await import('@controller/app/api/(admin)/admin/ecom/compute-pricing/route')
    messagePricing = await import('@controller/app/api/(admin)/admin/ecom/message-pricing/route')
    customersOverview = await import('@controller/app/api/(admin)/admin/ecom/customers/overview/route')
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['ecom_billing:read', 'ecom_customers:read'], 'manager'))
  })

  afterAll(async () => {
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    if (insertedPriceKeys.length)
      await db
        .query(`DELETE FROM ai_price_list WHERE (capability || '|' || provider || '|' || model || '|' || unit_type) = ANY($1::text[])`, [insertedPriceKeys])
        .catch(() => {})
    await endPool()
  })

  // ---- ecom/ai-pricing ----
  describe('ecom/ai-pricing', () => {
    const url = 'http://localhost/api/admin/ecom/ai-pricing'

    it('GET 401 without a session', async () => {
      const res = await aiPricing.GET(await apiRequest('GET', url) as any)
      expect(res.status).toBe(401)
    })

    it('GET 403 for an admin whose role is not platform-admin (has the read scope)', async () => {
      const res = await aiPricing.GET(await apiRequest('GET', url, { sid: narrowSid }) as any)
      expect(res.status).toBe(403)
    })

    it('GET 200 for the platform administrator, returning rows[] from ai_price_list', async () => {
      const res = await aiPricing.GET(await apiRequest('GET', url, { sid: fullSid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.rows)).toBe(true)
    })

    it('POST 403 for a non-platform admin', async () => {
      const res = await aiPricing.POST(
        await apiRequest('POST', url, { sid: narrowSid, body: { capability: 'text', provider: 'openai', unit_type: 'token_1k_in' } }) as any
      )
      expect(res.status).toBe(403)
    })

    it('POST 400 when required fields are missing/invalid', async () => {
      const res = await aiPricing.POST(await apiRequest('POST', url, { sid: fullSid, body: { capability: 'nope', unit_type: 'token_1k_in' } }) as any)
      expect(res.status).toBe(400)
    })

    it('POST 201 inserts a real ai_price_list row (side-effect verified in DB)', async () => {
      const provider = `test-${FIXTURES.adminId.slice(-6)}`
      const model = `m-${Date.now()}`
      insertedPriceKeys.push(`text|${provider}|${model}|token_1k_in`)
      const res = await aiPricing.POST(
        await apiRequest('POST', url, {
          sid: fullSid,
          body: { capability: 'text', provider, model, unit_type: 'token_1k_in', cost_inr: 1.5, price_inr: 3 },
        }) as any
      )
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.row).toMatchObject({ capability: 'text', provider, model, unit_type: 'token_1k_in' })
      const check = await db.query(
        `SELECT cost_inr::float8 AS cost, price_inr::float8 AS price FROM ai_price_list WHERE capability='text' AND provider=$1 AND model=$2 AND unit_type='token_1k_in'`,
        [provider, model]
      )
      expect(check.rows).toHaveLength(1)
      expect(check.rows[0]).toMatchObject({ cost: 1.5, price: 3 })
    })

    it('PATCH 400 without a valid id', async () => {
      const res = await aiPricing.PATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { price_inr: 2 } }) as any)
      expect(res.status).toBe(400)
    })
  })

  // ---- ecom/compute-pricing ----
  describe('ecom/compute-pricing', () => {
    const url = 'http://localhost/api/admin/ecom/compute-pricing'

    it('GET 401 without a session', async () => {
      const res = await computePricing.GET(await apiRequest('GET', url) as any)
      expect(res.status).toBe(401)
    })

    it('GET 403 for a non-platform admin', async () => {
      const res = await computePricing.GET(await apiRequest('GET', url, { sid: narrowSid }) as any)
      expect(res.status).toBe(403)
    })

    it('GET 200 for the platform administrator (real getCatalog/computePlans against jeffi_test)', async () => {
      const res = await computePricing.GET(await apiRequest('GET', url, { sid: fullSid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.plans)).toBe(true)
      expect(Array.isArray(body.presets)).toBe(true)
    })

    it('PATCH 403 for a non-platform admin', async () => {
      const res = await computePricing.PATCH(await apiRequest('PATCH', url, { sid: narrowSid, body: { settings: { margin: 0.2 } } }) as any)
      expect(res.status).toBe(403)
    })

    it('PATCH 400 when a settings value is out of bounds', async () => {
      // margin bound is [0,5]; 99 must be rejected before any write.
      const res = await computePricing.PATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { settings: { margin: 99 } } }) as any)
      expect(res.status).toBe(400)
    })
  })

  // ---- ecom/message-pricing ----
  describe('ecom/message-pricing', () => {
    const url = 'http://localhost/api/admin/ecom/message-pricing'

    it('GET 401 without a session', async () => {
      const res = await messagePricing.GET(await apiRequest('GET', url) as any)
      expect(res.status).toBe(401)
    })

    it('GET 403 for a non-platform admin', async () => {
      const res = await messagePricing.GET(await apiRequest('GET', url, { sid: narrowSid }) as any)
      expect(res.status).toBe(403)
    })

    it('GET 200 for the platform administrator (sheet + rows)', async () => {
      const res = await messagePricing.GET(await apiRequest('GET', url, { sid: fullSid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('sheet')
      expect(Array.isArray(body.rows)).toBe(true)
    })
  })

  // ---- ecom/customers/overview (shared ecomOverviewGet gate) ----
  describe('ecom/customers/overview', () => {
    const url = 'http://localhost/api/admin/ecom/customers/overview'

    it('GET 401 without a session', async () => {
      const res = await customersOverview.GET(await apiRequest('GET', url) as any)
      expect(res.status).toBe(401)
    })

    it('GET 403 for an admin lacking ecom_customers:read / platform role', async () => {
      // 'manager' here holds ecom_customers:read but is not platform-admin → gate at isPlatformAdmin.
      const res = await customersOverview.GET(await apiRequest('GET', url, { sid: narrowSid }) as any)
      expect(res.status).toBe(403)
    })

    it('GET 400 for an invalid from/to range', async () => {
      const res = await customersOverview.GET(await apiRequest('GET', `${url}?from=not-a-date&to=2026-01-01`, { sid: fullSid }) as any)
      expect(res.status).toBe(400)
    })

    it('GET 200 for the platform administrator, real control-plane aggregation', async () => {
      const res = await customersOverview.GET(await apiRequest('GET', url, { sid: fullSid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toBeTypeOf('object')
    })
  })
})
