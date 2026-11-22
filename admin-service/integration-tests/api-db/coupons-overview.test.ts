// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — coupons/overview (GET, coupons:read via requireAdminScope).
// Runs the real aggregate SQL over coupon_usage/orders against jeffi_test.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin coupons overview API — scope gate + real aggregates (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/coupons/overview/route')
    GET = route.GET as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
  })

  afterAll(async () => {
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('401 without a session', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/coupons/overview') as any)
    expect(res.status).toBe(401)
  })

  it('403 for an admin lacking coupons:read', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/coupons/overview', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('200 returns the overview shape from real aggregate SQL', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/coupons/overview', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('current')
    expect(body).toHaveProperty('series')
    expect(Array.isArray(body.series)).toBe(true)
    expect(Array.isArray(body.top)).toBe(true)
    expect(body).toHaveProperty('state')
  })

  it('200 with an explicit from/to period', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/coupons/overview?from=2026-01-01&to=2026-12-31', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.period).toBeTruthy()
    expect(body).toHaveProperty('bucket')
  })
})
