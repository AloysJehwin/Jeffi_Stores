// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — customer activity log + health. Both scope-gated reads;
// activity reads customer_activity_log (seeded row shows up), health recompute writes customer_health.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin customers/[id] activity + health API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let actGET: (req: any, ctx: any) => Promise<Response>
  let healthGET: (req: any, ctx: any) => Promise<Response>
  let healthPOST: (req: any, ctx: any) => Promise<Response>
  let fullSid = ''
  let narrowSid = ''
  const userId = crypto.randomUUID()
  const sfx = uniqueSuffix()
  const ctx = { params: Promise.resolve({ id: userId }) }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const act = await import('@admin/app/api/(admin)/admin/customers/[id]/activity/route')
    const health = await import('@admin/app/api/(admin)/admin/customers/[id]/health/route')
    actGET = act.GET as any
    healthGET = health.GET as any
    healthPOST = health.POST as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, user_type) VALUES ($1, $2, 'Act', 'Target', 'customer')`,
      [userId, `act-${sfx}@jeffi.test`]
    )
    await db.query(
      `INSERT INTO customer_activity_log (user_id, kind, summary) VALUES ($1, 'login', $2)`,
      [userId, `logged in ${sfx}`]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM customer_health WHERE user_id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM customer_activity_log WHERE user_id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('activity GET 401 / 403 gate', async () => {
    expect((await actGET(await apiRequest('GET', 'http://localhost/x') as any, ctx)).status).toBe(401)
    expect((await actGET(await apiRequest('GET', 'http://localhost/x', { sid: narrowSid }) as any, ctx)).status).toBe(403)
  })

  it('activity GET returns the seeded event from the DB', async () => {
    const res = await actGET(await apiRequest('GET', 'http://localhost/x?limit=50', { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    const ev = body.events.find((e: any) => e.summary === `logged in ${sfx}`)
    expect(ev).toBeTruthy()
    expect(ev.kind).toBe('login')
  })

  it('health GET is read-scoped (403 for narrow admin)', async () => {
    expect((await healthGET(await apiRequest('GET', 'http://localhost/x') as any, ctx)).status).toBe(401)
    expect((await healthGET(await apiRequest('GET', 'http://localhost/x', { sid: narrowSid }) as any, ctx)).status).toBe(403)
  })

  it('health POST (recompute) is write-scoped and persists a customer_health row', async () => {
    // read-only admin cannot recompute
    expect((await healthPOST(await apiRequest('POST', 'http://localhost/x', { sid: narrowSid }) as any, ctx)).status).toBe(403)

    const res = await healthPOST(await apiRequest('POST', 'http://localhost/x', { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.health).toBeTruthy()
    const row = await db.queryOne<{ user_id: string; score: number }>(
      `SELECT user_id, score FROM customer_health WHERE user_id = $1`,
      [userId]
    )
    expect(row?.user_id).toBe(userId)
    expect(typeof row?.score).toBe('number')
  })
})
