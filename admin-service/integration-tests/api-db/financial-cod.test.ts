// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — Finance → COD remittance. GET gates on financial:read,
// POST on financial:write and really flips cod_collected orders to paid (writes cod_remitted_at).
// Real authenticateAdmin→hasScope chain; real UPDATE verified by reading orders back.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, cleanupRows, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

const uid = () => crypto.randomUUID()

describe.skipIf(!API_DB_ENABLED)('admin financial COD remittance (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let POST: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  const sessionIds: string[] = []
  const base = 'http://localhost/api/admin/financial/cod-remittance'
  // A collected COD order the POST should remit, and a pending one it must leave alone.
  const collectedId = uid()
  const pendingId = uid()

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/financial/cod-remittance/route')
    GET = route.GET as any
    POST = route.POST as any
    const f = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'); fullSid = f.sid; sessionIds.push(f.id)
    const nn = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'); narrowSid = nn.sid; sessionIds.push(nn.id)

    await db.query(
      `INSERT INTO orders (id, order_number, status, payment_status, payment_mode, subtotal, total_amount, delivered_at)
       VALUES ($1,$2,'delivered','cod_collected','cod',1000,1000, NOW()),
              ($3,$4,'delivered','cod_pending','cod',500,500, NOW())`,
      [collectedId, `COD-${collectedId.slice(0, 8)}`, pendingId, `COD-${pendingId.slice(0, 8)}`]
    )
  })

  afterAll(async () => {
    await cleanupRows(db, [{ table: 'orders', ids: [collectedId, pendingId] }])
    await db.query(`DELETE FROM auth_sessions WHERE id = ANY($1::uuid[])`, [sessionIds]).catch(() => {})
    await endPool()
  })

  it('GET 401 without a session', async () => {
    expect((await GET(await apiRequest('GET', base) as any)).status).toBe(401)
  })

  it('GET 403 for an admin lacking financial:read', async () => {
    expect((await GET(await apiRequest('GET', base, { sid: narrowSid }) as any)).status).toBe(403)
  })

  it('GET 200 returns the COD contract shape', async () => {
    const res = await GET(await apiRequest('GET', base, { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('current')
    expect(Array.isArray(body.by_dim)).toBe(true)
    expect(Array.isArray(body.top)).toBe(true)
  })

  it('GET 400 on bad date range', async () => {
    const res = await GET(await apiRequest('GET', `${base}?from=2026-02-01&to=2026-01-01`, { sid: fullSid }) as any)
    expect(res.status).toBe(400)
  })

  it('POST 401 without a session', async () => {
    expect((await POST(await apiRequest('POST', base, { body: { orderIds: [collectedId] } }) as any)).status).toBe(401)
  })

  it('POST 403 for an admin lacking financial:write', async () => {
    const res = await POST(await apiRequest('POST', base, { sid: narrowSid, body: { orderIds: [collectedId] } }) as any)
    expect(res.status).toBe(403)
  })

  it('POST 400 when orderIds is missing/empty', async () => {
    const res = await POST(await apiRequest('POST', base, { sid: fullSid, body: { orderIds: [] } }) as any)
    expect(res.status).toBe(400)
  })

  it('POST remits a collected order and leaves a pending one', async () => {
    const res = await POST(
      await apiRequest('POST', base, { sid: fullSid, body: { orderIds: [collectedId, pendingId] } }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.marked).toBe(1) // only the cod_collected row qualifies

    const rows = await db.query<{ id: string; payment_status: string; cod_remitted_at: string | null }>(
      `SELECT id, payment_status, cod_remitted_at FROM orders WHERE id = ANY($1::uuid[])`,
      [[collectedId, pendingId]]
    )
    const byId = Object.fromEntries(rows.rows.map(r => [r.id, r]))
    expect(byId[collectedId].payment_status).toBe('paid')
    expect(byId[collectedId].cod_remitted_at).not.toBeNull()
    expect(byId[pendingId].payment_status).toBe('cod_pending')
    expect(byId[pendingId].cod_remitted_at).toBeNull()
  })
})
