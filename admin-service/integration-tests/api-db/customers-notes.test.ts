// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — customer notes. JSON POST path (no multipart), real
// customer_notes writes, scope gate, validation (empty note → 400, bad order ref → 400),
// PATCH share toggle (404 for unknown note), DELETE.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin customers/[id]/notes API (real DB)', () => {
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
  let noteId = ''

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/customers/[id]/notes/route')
    GET = route.GET as any
    POST = route.POST as any
    PATCH = route.PATCH as any
    DELETE = route.DELETE as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['customers:read'], 'manager'))
    ;({ sid: noReadSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, user_type) VALUES ($1, $2, 'Note', 'Target', 'customer')`,
      [userId, `notes-${sfx}@jeffi.test`]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM customer_notes WHERE user_id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('GET 401 / 403 gate', async () => {
    expect((await GET(await apiRequest('GET', 'http://localhost/x') as any, ctx)).status).toBe(401)
    expect((await GET(await apiRequest('GET', 'http://localhost/x', { sid: noReadSid }) as any, ctx)).status).toBe(403)
  })

  it('POST requires customers:write (read-only admin → 403)', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/x', { sid: narrowSid, body: { body: 'hi' } }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('POST with no title/body/files → 400', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/x', { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('POST with a non-uuid order reference → 400', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/x', { sid: fullSid, body: { body: 'x', orderId: 'not-a-uuid' } }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('POST creates a note (JSON path) and persists body + admin_id', async () => {
    const res = await POST(
      await apiRequest('POST', 'http://localhost/x', { sid: fullSid, body: { title: `T-${sfx}`, body: `Note body ${sfx}`, tags: ['follow-up'] } }) as any,
      ctx
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    noteId = body.note?.id
    expect(noteId).toBeTruthy()
    const row = await db.queryOne<{ body: string; admin_id: string; shared_with_customer: boolean }>(
      `SELECT body, admin_id, shared_with_customer FROM customer_notes WHERE id = $1`,
      [noteId]
    )
    expect(row?.body).toBe(`Note body ${sfx}`)
    expect(row?.admin_id).toBe(FIXTURES.adminId)
    expect(row?.shared_with_customer).toBe(false)
  })

  it('GET reads the note back', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/x', { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.notes.some((n: any) => n.id === noteId)).toBe(true)
  })

  it('PATCH rejects a non-uuid noteId (400) and 404s an unknown note', async () => {
    const bad = await PATCH(await apiRequest('PATCH', 'http://localhost/x', { sid: fullSid, body: { noteId: 'nope', shared: true } }) as any, ctx)
    expect(bad.status).toBe(400)
    const missing = await PATCH(await apiRequest('PATCH', 'http://localhost/x', { sid: fullSid, body: { noteId: crypto.randomUUID(), shared: true } }) as any, ctx)
    expect(missing.status).toBe(404)
  })

  it('PATCH toggles shared_with_customer in the DB', async () => {
    const res = await PATCH(await apiRequest('PATCH', 'http://localhost/x', { sid: fullSid, body: { noteId, shared: true } }) as any, ctx)
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ shared_with_customer: boolean }>(`SELECT shared_with_customer FROM customer_notes WHERE id = $1`, [noteId])
    expect(row?.shared_with_customer).toBe(true)
  })

  it('DELETE without noteId → 400; with it, removes the note', async () => {
    expect((await DELETE(await apiRequest('DELETE', 'http://localhost/x', { sid: fullSid }) as any, ctx)).status).toBe(400)
    const res = await DELETE(await apiRequest('DELETE', `http://localhost/x?noteId=${noteId}`, { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(200)
    const row = await db.queryOne(`SELECT 1 FROM customer_notes WHERE id = $1`, [noteId])
    expect(row).toBeNull()
  })
})
