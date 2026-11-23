// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — storefront (public) coupons: /apply (POST) and /nudge (GET).
// Both read/write Postgres directly. Real customer session (Bearer sid) + seeded coupons + validation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('coupons API (real DB)', () => {
  let APPLY: (req: any) => Promise<Response>
  let NUDGE: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId
  const sfx = uniqueSuffix()
  // Seeded coupon codes (uppercased — apply uppercases the lookup code).
  const PUBLIC10 = `PUB10${sfx}`.toUpperCase()
  const PUBMIN = `PUBMIN${sfx}`.toUpperCase()
  const FLAT = `FLAT${sfx}`.toUpperCase()
  const EXPIRED = `EXP${sfx}`.toUpperCase()
  const INACTIVE = `INACT${sfx}`.toUpperCase()
  const MINE = `MINE${sfx}`.toUpperCase()
  const OTHERS = `OTHERS${sfx}`.toUpperCase()
  const ELIGIBLE = `ELIG${sfx}`.toUpperCase()
  const ids: Record<string, string> = {}

  async function seedCoupon(code: string, cols: Record<string, unknown>): Promise<string> {
    const base: Record<string, unknown> = {
      code,
      discount_type: 'percentage',
      discount_value: 10,
      min_purchase_amount: 0,
      is_active: true,
      is_draft: false,
      auto_generated: false,
    }
    const merged = { ...base, ...cols }
    const keys = Object.keys(merged)
    const params = keys.map((_, i) => `$${i + 1}`).join(', ')
    const row = await db.queryOne<{ id: string }>(
      `INSERT INTO coupons (${keys.join(', ')}) VALUES (${params}) RETURNING id`,
      keys.map((k) => merged[k])
    )
    ids[code] = row!.id
    return row!.id
  }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const apply = await import('@storefront/app/api/(public)/coupons/apply/route')
    const nudge = await import('@storefront/app/api/(public)/coupons/nudge/route')
    APPLY = apply.POST as any
    NUDGE = nudge.GET as any
    ;({ sid } = await makeCustomerSession(auth, userId))

    // Public 10% coupon, no min, unlimited per-user.
    await seedCoupon(PUBLIC10, { discount_value: 10, usage_limit_per_user: null })
    // Public 20% coupon requiring a min purchase of 500, capped at 50.
    await seedCoupon(PUBMIN, { discount_value: 20, min_purchase_amount: 500, max_discount_amount: 50, usage_limit_per_user: null })
    // Flat 100 off.
    await seedCoupon(FLAT, { discount_type: 'fixed', discount_value: 100, usage_limit_per_user: null })
    // Expired.
    await seedCoupon(EXPIRED, { valid_until: '2000-01-01T00:00:00Z' })
    // Inactive.
    await seedCoupon(INACTIVE, { is_active: false })
    // Generated for THIS user.
    await seedCoupon(MINE, { generated_for_user_id: userId, auto_generated: true })
    // Generated for some OTHER user.
    await seedCoupon(OTHERS, { generated_for_user_id: FIXTURES.adminUserId, auto_generated: true })
    // Restricted via eligible-users list (our user is NOT on it).
    const eligId = await seedCoupon(ELIGIBLE, { usage_limit_per_user: null })
    await db.query(`INSERT INTO coupon_eligible_users (coupon_id, user_id) VALUES ($1, $2)`, [eligId, FIXTURES.adminUserId])
  })

  afterAll(async () => {
    const all = Object.values(ids)
    await db.query('DELETE FROM coupon_eligible_users WHERE coupon_id = ANY($1::uuid[])', [all]).catch(() => {})
    await db.query('DELETE FROM coupon_usage WHERE coupon_id = ANY($1::uuid[])', [all]).catch(() => {})
    await db.query('DELETE FROM coupons WHERE id = ANY($1::uuid[])', [all]).catch(() => {})
    await endPool()
  })

  // ---- /apply (POST) ----

  it('POST /apply computes a percentage discount for a valid public coupon', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: PUBLIC10, subtotal: 1000 } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.code).toBe(PUBLIC10)
    expect(body.discountType).toBe('percentage')
    expect(body.discountAmount).toBe(100) // 10% of 1000
    expect(body.couponId).toBe(ids[PUBLIC10])
  })

  it('POST /apply caps a percentage discount at max_discount_amount', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: PUBMIN, subtotal: 1000 } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.discountAmount).toBe(50) // 20% of 1000 = 200, capped at 50
  })

  it('POST /apply returns a flat (fixed) discount amount', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: FLAT, subtotal: 1000 } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.discountType).toBe('fixed')
    expect(body.discountAmount).toBe(100)
  })

  it('POST /apply resolves a coupon by couponId (uuid union branch)', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { couponId: ids[PUBLIC10], subtotal: 200 } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.code).toBe(PUBLIC10)
    expect(body.discountAmount).toBe(20) // 10% of 200
  })

  it('POST /apply caps the discount at the subtotal (flat > subtotal)', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: FLAT, subtotal: 40 } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.discountAmount).toBe(40) // min(100, 40)
  })

  it('POST /apply 404 for an unknown code', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: `NOPE${sfx}`.toUpperCase(), subtotal: 100 } }) as any)
    expect(res.status).toBe(404)
  })

  it('POST /apply 400 when below min_purchase_amount', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: PUBMIN, subtotal: 100 } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST /apply 400 for an expired coupon', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: EXPIRED, subtotal: 1000 } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST /apply 400 for an inactive coupon', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: INACTIVE, subtotal: 1000 } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST /apply accepts a coupon generated for this user', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: MINE, subtotal: 1000 } }) as any)
    expect(res.status).toBe(200)
  })

  it('POST /apply 400 for a coupon generated for a different user', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: OTHERS, subtotal: 1000 } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST /apply 400 when the user is not on the eligible-users list', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: ELIGIBLE, subtotal: 1000 } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST /apply 400 when usage_limit_per_user is reached', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: PUBLIC10, subtotal: 1000 } }) as any)
    // control: PUBLIC10 has unlimited per-user -> 200
    expect(res.status).toBe(200)
    // Seed a limited coupon and a usage row so the per-user cap trips.
    const code = `CAP${sfx}`.toUpperCase()
    await seedCoupon(code, { usage_limit_per_user: 1 })
    await db.query(`INSERT INTO coupon_usage (coupon_id, user_id, discount_amount) VALUES ($1, $2, $3)`, [ids[code], userId, 10])
    const res2 = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code, subtotal: 1000 } }) as any)
    expect(res2.status).toBe(400)
  })

  it('POST /apply 400 on invalid payload (missing subtotal)', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { sid, body: { code: PUBLIC10 } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST /apply 401 for an unauthenticated request', async () => {
    const res = await APPLY(await apiRequest('POST', 'http://localhost/api/coupons/apply', { body: { code: PUBLIC10, subtotal: 1000 } }) as any)
    expect(res.status).toBe(401)
  })

  // ---- /nudge (GET) ----

  it('GET /nudge returns an applicable public coupon as the best nudge', async () => {
    const res = await NUDGE(await apiRequest('GET', `http://localhost/api/coupons/nudge?subtotal=1000`, { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nudge).toBeTruthy()
    // PUBMIN (20% capped 50) and PUBLIC10 (10% = 100) both apply at 1000; PUBLIC10 saves more.
    expect(body.nudge.saving).toBeGreaterThan(0)
    expect(body.nudge.shortfall).toBe(0)
  })

  it('GET /nudge returns a best applicable coupon at a low subtotal (our flat/10% seeds have no min)', async () => {
    // FLAT (min 0) and PUBLIC10 (min 0) still apply at 400, so pickNudge returns an applied coupon
    // (shortfall 0) rather than reaching the nearest-locked branch.
    const res = await NUDGE(await apiRequest('GET', `http://localhost/api/coupons/nudge?subtotal=400`, { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nudge).toBeTruthy()
    expect(body.nudge.saving).toBeGreaterThan(0)
    expect(body.nudge.shortfall).toBe(0)
  })

  it('GET /nudge returns null for a zero/negative subtotal', async () => {
    const res = await NUDGE(await apiRequest('GET', `http://localhost/api/coupons/nudge?subtotal=0`, { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nudge).toBeNull()
  })

  it('GET /nudge 400 for a missing/invalid subtotal', async () => {
    const res = await NUDGE(await apiRequest('GET', `http://localhost/api/coupons/nudge`, { sid }) as any)
    expect(res.status).toBe(400)
  })

  it('GET /nudge works for a guest (no session)', async () => {
    const res = await NUDGE(await apiRequest('GET', `http://localhost/api/coupons/nudge?subtotal=1000`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.nudge).toBeTruthy()
  })
})
