// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — coupons/[id]/eligible-users (POST/DELETE) and coupons/user-pool (GET).
// eligible-users requires coupons:write; user-pool requires customers:read. Real coupon_eligible_users writes/reads.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin coupons eligible-users + user-pool API (real DB)', () => {
  let eligiblePOST: (req: any, ctx: any) => Promise<Response>
  let eligibleDELETE: (req: any, ctx: any) => Promise<Response>
  let poolGET: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  const couponId = crypto.randomUUID()
  const userId = FIXTURES.customerId

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const eligible = await import('@admin/app/api/(admin)/admin/coupons/[id]/eligible-users/route')
    const pool = await import('@admin/app/api/(admin)/admin/coupons/user-pool/route')
    eligiblePOST = eligible.POST as any
    eligibleDELETE = eligible.DELETE as any
    poolGET = pool.GET as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    await db.query(`INSERT INTO coupons (id, code, discount_type, discount_value) VALUES ($1,$2,'fixed',5)`, [couponId, `ELIG${crypto.randomBytes(4).toString('hex').toUpperCase()}`])
  })

  afterAll(async () => {
    await db.query(`DELETE FROM coupon_eligible_users WHERE coupon_id=$1`, [couponId]).catch(() => {})
    await db.query(`DELETE FROM coupons WHERE id=$1`, [couponId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // --- eligible-users POST (coupons:write) ---
  it('eligible POST 401 without a session', async () => {
    const res = await eligiblePOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/eligible-users`, { body: { user_id: userId } }) as any, { params: Promise.resolve({ id: couponId }) })
    expect(res.status).toBe(401)
  })

  it('eligible POST 403 for an admin lacking coupons:write', async () => {
    const res = await eligiblePOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/eligible-users`, { sid: narrowSid, body: { user_id: userId } }) as any, { params: Promise.resolve({ id: couponId }) })
    expect(res.status).toBe(403)
  })

  it('eligible POST 400 when user_id is missing', async () => {
    const res = await eligiblePOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/eligible-users`, { sid: fullSid, body: {} }) as any, { params: Promise.resolve({ id: couponId }) })
    expect(res.status).toBe(400)
  })

  it('eligible POST 404 for a non-existent coupon', async () => {
    const ghost = crypto.randomUUID()
    const res = await eligiblePOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${ghost}/eligible-users`, { sid: fullSid, body: { user_id: userId } }) as any, { params: Promise.resolve({ id: ghost }) })
    expect(res.status).toBe(404)
  })

  it('eligible POST 200 inserts the eligibility row', async () => {
    const res = await eligiblePOST(await apiRequest('POST', `http://localhost/api/admin/coupons/${couponId}/eligible-users`, { sid: fullSid, body: { user_id: userId } }) as any, { params: Promise.resolve({ id: couponId }) })
    expect(res.status).toBe(200)
    const rows = await db.query(`SELECT 1 FROM coupon_eligible_users WHERE coupon_id=$1 AND user_id=$2`, [couponId, userId])
    expect(rows.rows.length).toBe(1)
  })

  // --- eligible-users DELETE (coupons:write) ---
  it('eligible DELETE 403 for an admin lacking coupons:write', async () => {
    const res = await eligibleDELETE(await apiRequest('DELETE', `http://localhost/api/admin/coupons/${couponId}/eligible-users`, { sid: narrowSid, body: { user_id: userId } }) as any, { params: Promise.resolve({ id: couponId }) })
    expect(res.status).toBe(403)
  })

  it('eligible DELETE 400 when user_id is missing', async () => {
    const res = await eligibleDELETE(await apiRequest('DELETE', `http://localhost/api/admin/coupons/${couponId}/eligible-users`, { sid: fullSid, body: {} }) as any, { params: Promise.resolve({ id: couponId }) })
    expect(res.status).toBe(400)
  })

  it('eligible DELETE 200 removes the eligibility row', async () => {
    const res = await eligibleDELETE(await apiRequest('DELETE', `http://localhost/api/admin/coupons/${couponId}/eligible-users`, { sid: fullSid, body: { user_id: userId } }) as any, { params: Promise.resolve({ id: couponId }) })
    expect(res.status).toBe(200)
    const rows = await db.query(`SELECT 1 FROM coupon_eligible_users WHERE coupon_id=$1 AND user_id=$2`, [couponId, userId])
    expect(rows.rows.length).toBe(0)
  })

  // --- user-pool GET (customers:read) ---
  it('user-pool GET 401 without a session', async () => {
    const res = await poolGET(await apiRequest('GET', 'http://localhost/api/admin/coupons/user-pool?mode=all') as any)
    expect(res.status).toBe(401)
  })

  it('user-pool GET 403 for an admin lacking customers:read', async () => {
    const res = await poolGET(await apiRequest('GET', 'http://localhost/api/admin/coupons/user-pool?mode=all', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('user-pool GET 200 for mode=all returns real users + count', async () => {
    const res = await poolGET(await apiRequest('GET', 'http://localhost/api/admin/coupons/user-pool?mode=all', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.users)).toBe(true)
    expect(body.count).toBe(body.users.length)
  })

  it('user-pool GET 400 for an unknown segment', async () => {
    const res = await poolGET(await apiRequest('GET', 'http://localhost/api/admin/coupons/user-pool?mode=segment&segment=bogus', { sid: fullSid }) as any)
    expect(res.status).toBe(400)
  })

  it('user-pool GET 400 for an invalid mode', async () => {
    const res = await poolGET(await apiRequest('GET', 'http://localhost/api/admin/coupons/user-pool?mode=wat', { sid: fullSid }) as any)
    expect(res.status).toBe(400)
  })

  it('user-pool GET 200 for mode=segment&segment=lead (real query)', async () => {
    const res = await poolGET(await apiRequest('GET', 'http://localhost/api/admin/coupons/user-pool?mode=segment&segment=lead', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.users)).toBe(true)
  })

  it('user-pool GET 200 for mode=score (joins customer_health)', async () => {
    const res = await poolGET(await apiRequest('GET', 'http://localhost/api/admin/coupons/user-pool?mode=score&score_min=0&score_max=100', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.users)).toBe(true)
  })
})
