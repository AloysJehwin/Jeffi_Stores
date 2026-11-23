// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — customer tags. GET read-scope, POST/DELETE write-scope,
// real customer_tags writes (query the table back), validation (empty tag → 400, missing param → 400).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin customers/[id]/tags API (real DB)', () => {
  let GET: (req: any, ctx: any) => Promise<Response>
  let POST: (req: any, ctx: any) => Promise<Response>
  let DELETE: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = '' // has customers:read but NOT customers:write (write-gate 403)
  let noReadSid = '' // lacks customers:read entirely (read-gate 403)
  const userId = crypto.randomUUID()
  const sfx = uniqueSuffix()
  const tag = `vip-${sfx}`
  const ctx = { params: Promise.resolve({ id: userId }) }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/customers/[id]/tags/route')
    GET = route.GET as any
    POST = route.POST as any
    DELETE = route.DELETE as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['customers:read'], 'manager'))
    ;({ sid: noReadSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, user_type) VALUES ($1, $2, 'Tag', 'Target', 'customer')`,
      [userId, `tags-${sfx}@jeffi.test`]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM customer_activity_log WHERE user_id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM customer_tags WHERE user_id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('GET 401 / 403 gate', async () => {
    expect((await GET(await apiRequest('GET', 'http://localhost/x') as any, ctx)).status).toBe(401)
    expect((await GET(await apiRequest('GET', 'http://localhost/x', { sid: noReadSid }) as any, ctx)).status).toBe(403)
  })

  it('POST requires customers:write (narrow read-only admin → 403)', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/x', { sid: narrowSid, body: { tag } }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('POST rejects an empty tag (400)', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/x', { sid: fullSid, body: { tag: '   ' } }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('POST inserts a tag (lowercased) and GET reads it back from the DB', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/x', { sid: fullSid, body: { tag: tag.toUpperCase() } }) as any, ctx)
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ tag: string; created_by: string }>(
      `SELECT tag, created_by FROM customer_tags WHERE user_id = $1 AND tag = $2`,
      [userId, tag]
    )
    expect(row?.tag).toBe(tag)
    expect(row?.created_by).toBe(FIXTURES.adminId)

    const getRes = await GET(await apiRequest('GET', 'http://localhost/x', { sid: fullSid }) as any, ctx)
    expect(getRes.status).toBe(200)
    const body = await getRes.json()
    expect(body.tags.some((t: any) => t.tag === tag)).toBe(true)
  })

  it('DELETE without a tag param → 400', async () => {
    const res = await DELETE(await apiRequest('DELETE', 'http://localhost/x', { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('DELETE removes the tag from the DB', async () => {
    const res = await DELETE(await apiRequest('DELETE', `http://localhost/x?tag=${tag}`, { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(200)
    const row = await db.queryOne(`SELECT 1 FROM customer_tags WHERE user_id = $1 AND tag = $2`, [userId, tag])
    expect(row).toBeNull()
  })
})
