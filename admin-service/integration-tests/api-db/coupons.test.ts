// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — admin coupons list/create (route.ts) + [id] PATCH/DELETE.
// Real authenticateAdmin → resolveSession → hasScope chain + real coupons table writes/reads.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin coupons API — list/create/update/delete (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let POST: (req: any) => Promise<Response>
  let PATCH: (req: any, ctx: any) => Promise<Response>
  let DELETE: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  const seededCode = `TEST${crypto.randomBytes(4).toString('hex').toUpperCase()}`
  const seededId = crypto.randomUUID()
  const createdIds: string[] = [seededId]

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const list = await import('@admin/app/api/(admin)/admin/coupons/route')
    const byId = await import('@admin/app/api/(admin)/admin/coupons/[id]/route')
    GET = list.GET as any
    POST = list.POST as any
    PATCH = byId.PATCH as any
    DELETE = byId.DELETE as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    // One known coupon so list/read assertions have real data.
    await db.query(
      `INSERT INTO coupons (id, code, discount_type, discount_value, is_active) VALUES ($1,$2,'percentage',10,true)`,
      [seededId, seededCode]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM coupons WHERE id = ANY($1::uuid[])`, [createdIds]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // --- GET /coupons (coupons:read) ---
  it('GET 401 without a session', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/coupons') as any)
    expect(res.status).toBe(401)
  })

  it('GET 403 for an admin lacking coupons:read', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/coupons', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('GET 200 returns real coupons + total, and search finds the seeded code', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/admin/coupons?search=${seededCode}`, { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.coupons)).toBe(true)
    expect(body).toHaveProperty('total')
    expect(body.coupons.some((c: any) => c.id === seededId)).toBe(true)
  })

  // --- POST /coupons (coupons:write) ---
  it('POST 401 without a session', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/admin/coupons', { body: { code: 'X', discount_type: 'fixed', discount_value: 1 } }) as any)
    expect(res.status).toBe(401)
  })

  it('POST 403 for an admin lacking coupons:write', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/admin/coupons', { sid: narrowSid, body: { code: 'X', discount_type: 'fixed', discount_value: 1 } }) as any)
    expect(res.status).toBe(403)
  })

  it('POST 400 on invalid payload (missing discount_value / bad type)', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/admin/coupons', { sid: fullSid, body: { code: 'NOPE', discount_type: 'bogus' } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST 201 writes a coupon that is then readable from the table', async () => {
    const code = `NEW${crypto.randomBytes(4).toString('hex').toUpperCase()}`
    const res = await POST(await apiRequest('POST', 'http://localhost/api/admin/coupons', { sid: fullSid, body: { code, discount_type: 'fixed', discount_value: 50 } }) as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.coupon.code).toBe(code) // uppercased already
    createdIds.push(body.coupon.id)
    const rows = await db.query(`SELECT code, discount_value FROM coupons WHERE id=$1`, [body.coupon.id])
    expect(rows.rows[0].code).toBe(code)
    expect(Number(rows.rows[0].discount_value)).toBe(50)
  })

  it('POST 409 on a duplicate code', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/admin/coupons', { sid: fullSid, body: { code: seededCode, discount_type: 'percentage', discount_value: 5 } }) as any)
    expect(res.status).toBe(409)
  })

  // --- PATCH /coupons/[id] (coupons:write) ---
  it('PATCH 401 without a session', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/coupons/${seededId}`, { body: { is_active: false } }) as any, { params: Promise.resolve({ id: seededId }) })
    expect(res.status).toBe(401)
  })

  it('PATCH 403 for an admin lacking coupons:write', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/coupons/${seededId}`, { sid: narrowSid, body: { is_active: false } }) as any, { params: Promise.resolve({ id: seededId }) })
    expect(res.status).toBe(403)
  })

  it('PATCH 400 when there are no fields to update', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/coupons/${seededId}`, { sid: fullSid, body: {} }) as any, { params: Promise.resolve({ id: seededId }) })
    expect(res.status).toBe(400)
  })

  it('PATCH 404 for a non-existent coupon', async () => {
    const ghost = crypto.randomUUID()
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/coupons/${ghost}`, { sid: fullSid, body: { is_active: false } }) as any, { params: Promise.resolve({ id: ghost }) })
    expect(res.status).toBe(404)
  })

  it('PATCH 200 updates the row (verified against the table)', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/coupons/${seededId}`, { sid: fullSid, body: { is_active: false, discount_value: 15 } }) as any, { params: Promise.resolve({ id: seededId }) })
    expect(res.status).toBe(200)
    const rows = await db.query(`SELECT is_active, discount_value FROM coupons WHERE id=$1`, [seededId])
    expect(rows.rows[0].is_active).toBe(false)
    expect(Number(rows.rows[0].discount_value)).toBe(15)
  })

  // --- DELETE /coupons/[id] (coupons:write) ---
  it('DELETE 401 without a session', async () => {
    const res = await DELETE(await apiRequest('DELETE', `http://localhost/api/admin/coupons/${seededId}`) as any, { params: Promise.resolve({ id: seededId }) })
    expect(res.status).toBe(401)
  })

  it('DELETE 403 for an admin lacking coupons:write', async () => {
    const res = await DELETE(await apiRequest('DELETE', `http://localhost/api/admin/coupons/${seededId}`, { sid: narrowSid }) as any, { params: Promise.resolve({ id: seededId }) })
    expect(res.status).toBe(403)
  })

  it('DELETE 200 removes the coupon from the table', async () => {
    const delId = crypto.randomUUID()
    createdIds.push(delId)
    await db.query(`INSERT INTO coupons (id, code, discount_type, discount_value) VALUES ($1,$2,'fixed',5)`, [delId, `DEL${crypto.randomBytes(4).toString('hex').toUpperCase()}`])
    const res = await DELETE(await apiRequest('DELETE', `http://localhost/api/admin/coupons/${delId}`, { sid: fullSid }) as any, { params: Promise.resolve({ id: delId }) })
    expect(res.status).toBe(200)
    const rows = await db.query(`SELECT 1 FROM coupons WHERE id=$1`, [delId])
    expect(rows.rows.length).toBe(0)
  })
})
