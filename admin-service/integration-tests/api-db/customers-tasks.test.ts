// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — customer tasks (list/create + per-task patch/delete).
// Scope gate, real customer_tasks writes, status filter, completion side-effect, validation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin customers/[id]/tasks API (real DB)', () => {
  let GET: (req: any, ctx: any) => Promise<Response>
  let POST: (req: any, ctx: any) => Promise<Response>
  let PATCH: (req: any, ctx: any) => Promise<Response>
  let DELETE: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = '' // customers:read, no write (write-gate 403)
  let noReadSid = '' // lacks customers:read (read-gate 403)
  const userId = crypto.randomUUID()
  const sfx = uniqueSuffix()
  const ctx = { params: Promise.resolve({ id: userId }) }
  let taskId = ''

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const list = await import('@admin/app/api/(admin)/admin/customers/[id]/tasks/route')
    const one = await import('@admin/app/api/(admin)/admin/customers/[id]/tasks/[taskId]/route')
    GET = list.GET as any
    POST = list.POST as any
    PATCH = one.PATCH as any
    DELETE = one.DELETE as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['customers:read'], 'manager'))
    ;({ sid: noReadSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, user_type) VALUES ($1, $2, 'Task', 'Target', 'customer')`,
      [userId, `tasks-${sfx}@jeffi.test`]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM customer_activity_log WHERE user_id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM customer_tasks WHERE user_id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('GET 401 / 403 gate', async () => {
    expect((await GET(await apiRequest('GET', 'http://localhost/x') as any, ctx)).status).toBe(401)
    expect((await GET(await apiRequest('GET', 'http://localhost/x', { sid: noReadSid }) as any, ctx)).status).toBe(403)
  })

  it('POST requires customers:write (read-only admin → 403)', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/x', { sid: narrowSid, body: { title: 'x' } }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('POST rejects an empty title (400)', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/x', { sid: fullSid, body: { title: '  ' } }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('POST creates a task and persists it with the defaulted priority', async () => {
    const res = await POST(
      await apiRequest('POST', 'http://localhost/x', { sid: fullSid, body: { title: `Call back ${sfx}`, priority: 'bogus' } }) as any,
      ctx
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    taskId = body.taskId
    const row = await db.queryOne<{ title: string; priority: string; status: string; created_by: string }>(
      `SELECT title, priority, status, created_by FROM customer_tasks WHERE id = $1`,
      [taskId]
    )
    expect(row?.title).toBe(`Call back ${sfx}`)
    expect(row?.priority).toBe('medium') // invalid priority falls back
    expect(row?.status).toBe('pending')
    expect(row?.created_by).toBe(FIXTURES.adminId)
  })

  it('GET lists the open task; status=completed filter excludes it', async () => {
    const open = await (await GET(await apiRequest('GET', 'http://localhost/x?status=open', { sid: fullSid }) as any, ctx)).json()
    expect(open.tasks.some((t: any) => t.id === taskId)).toBe(true)
    const done = await (await GET(await apiRequest('GET', 'http://localhost/x?status=completed', { sid: fullSid }) as any, ctx)).json()
    expect(done.tasks.some((t: any) => t.id === taskId)).toBe(false)
  })

  it('PATCH 404 for a task not belonging to the customer', async () => {
    const res = await PATCH(
      await apiRequest('PATCH', 'http://localhost/x', { sid: fullSid, body: { status: 'completed' } }) as any,
      { params: Promise.resolve({ id: userId, taskId: crypto.randomUUID() }) }
    )
    expect(res.status).toBe(404)
  })

  it('PATCH completing the task sets completed_at + completed_by', async () => {
    const res = await PATCH(
      await apiRequest('PATCH', 'http://localhost/x', { sid: fullSid, body: { status: 'completed' } }) as any,
      { params: Promise.resolve({ id: userId, taskId }) }
    )
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ status: string; completed_by: string; completed_at: string | null }>(
      `SELECT status, completed_by, completed_at FROM customer_tasks WHERE id = $1`,
      [taskId]
    )
    expect(row?.status).toBe('completed')
    expect(row?.completed_by).toBe(FIXTURES.adminId)
    expect(row?.completed_at).not.toBeNull()
  })

  it('DELETE removes the task from the DB', async () => {
    const res = await DELETE(
      await apiRequest('DELETE', 'http://localhost/x', { sid: fullSid }) as any,
      { params: Promise.resolve({ id: userId, taskId }) }
    )
    expect(res.status).toBe(200)
    const row = await db.queryOne(`SELECT 1 FROM customer_tasks WHERE id = $1`, [taskId])
    expect(row).toBeNull()
  })
})
