// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — Finance → Payables (expenses). Collection GET/POST,
// item GET, and the pay action. GET gates on financial:read, POST/pay on financial:write.
// Writes are verified by reading expenses / expense_payments back.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, cleanupRows, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

const uid = () => crypto.randomUUID()

describe.skipIf(!API_DB_ENABLED)('admin financial payables (real DB)', () => {
  let list: typeof import('@admin/app/api/(admin)/admin/financial/payables/route')
  let item: typeof import('@admin/app/api/(admin)/admin/financial/payables/[id]/route')
  let pay: typeof import('@admin/app/api/(admin)/admin/financial/payables/[id]/pay/route')
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  const sessionIds: string[] = []
  const base = 'http://localhost/api/admin/financial/payables'
  // A seeded unpaid expense for the item/pay tests; created expenses are tracked for cleanup.
  const seededExpenseId = uid()
  const createdExpenseIds: string[] = [seededExpenseId]

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    list = await import('@admin/app/api/(admin)/admin/financial/payables/route')
    item = await import('@admin/app/api/(admin)/admin/financial/payables/[id]/route')
    pay = await import('@admin/app/api/(admin)/admin/financial/payables/[id]/pay/route')
    const f = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'); fullSid = f.sid; sessionIds.push(f.id)
    const nn = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'); narrowSid = nn.sid; sessionIds.push(nn.id)

    await db.query(
      `INSERT INTO expenses (id, expense_number, supplier_name, amount, total_amount, expense_date, status)
       VALUES ($1,$2,'Seed Supplier',1000,1000,'2026-01-10','unpaid')`,
      [seededExpenseId, `EXP-SEED-${seededExpenseId.slice(0, 6)}`]
    )
  })

  afterAll(async () => {
    // Payments first (FK), then expenses, then the admin sessions.
    await db.query(`DELETE FROM expense_payments WHERE expense_id = ANY($1::uuid[])`, [createdExpenseIds]).catch(() => {})
    await cleanupRows(db, [{ table: 'expenses', ids: createdExpenseIds }])
    await db.query(`DELETE FROM auth_sessions WHERE id = ANY($1::uuid[])`, [sessionIds]).catch(() => {})
    await endPool()
  })

  // ---- collection GET ----
  it('GET 401 without a session', async () => {
    expect((await list.GET(await apiRequest('GET', base) as any)).status).toBe(401)
  })
  it('GET 403 for an admin lacking financial:read', async () => {
    expect((await list.GET(await apiRequest('GET', base, { sid: narrowSid }) as any)).status).toBe(403)
  })
  it('GET 200 returns the payables contract shape', async () => {
    const res = await list.GET(await apiRequest('GET', base, { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('current')
  })
  it('GET 400 on bad date range', async () => {
    const res = await list.GET(await apiRequest('GET', `${base}?from=2026-02-01&to=2026-01-01`, { sid: fullSid }) as any)
    expect(res.status).toBe(400)
  })

  // ---- collection POST (create expense) ----
  it('POST 401 without a session', async () => {
    const res = await list.POST(await apiRequest('POST', base, { body: { supplier_name: 'X', amount: '10', expense_date: '2026-01-01' } }) as any)
    expect(res.status).toBe(401)
  })
  it('POST 403 for an admin lacking financial:write', async () => {
    const res = await list.POST(await apiRequest('POST', base, { sid: narrowSid, body: { supplier_name: 'X', amount: '10', expense_date: '2026-01-01' } }) as any)
    expect(res.status).toBe(403)
  })
  it('POST 400 when required fields are missing', async () => {
    const res = await list.POST(await apiRequest('POST', base, { sid: fullSid, body: { supplier_name: 'X' } }) as any)
    expect(res.status).toBe(400)
  })
  it('POST creates an expense readable back from Postgres', async () => {
    const res = await list.POST(
      await apiRequest('POST', base, {
        sid: fullSid,
        body: { supplier_name: 'Acme Parts', amount: '1500', tax_amount: '270', expense_date: '2026-01-15', description: 'bolts' },
      }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(typeof body.id).toBe('string')
    createdExpenseIds.push(body.id)

    const row = await db.query<{ supplier_name: string; total_amount: string; status: string }>(
      `SELECT supplier_name, total_amount, status FROM expenses WHERE id = $1`,
      [body.id]
    )
    expect(row.rows[0].supplier_name).toBe('Acme Parts')
    expect(Number(row.rows[0].total_amount)).toBe(1770) // amount + tax
    expect(row.rows[0].status).toBe('unpaid')
  })

  // ---- item GET ----
  it('item GET 401 without a session', async () => {
    expect((await item.GET(await apiRequest('GET', `${base}/${seededExpenseId}`) as any, ctx(seededExpenseId))).status).toBe(401)
  })
  it('item GET 403 for an admin lacking financial:read', async () => {
    const res = await item.GET(await apiRequest('GET', `${base}/${seededExpenseId}`, { sid: narrowSid }) as any, ctx(seededExpenseId))
    expect(res.status).toBe(403)
  })
  it('item GET 404 for an unknown id', async () => {
    const missing = uid()
    const res = await item.GET(await apiRequest('GET', `${base}/${missing}`, { sid: fullSid }) as any, ctx(missing))
    expect(res.status).toBe(404)
  })
  it('item GET 200 returns the seeded expense', async () => {
    const res = await item.GET(await apiRequest('GET', `${base}/${seededExpenseId}`, { sid: fullSid }) as any, ctx(seededExpenseId))
    expect(res.status).toBe(200)
    const body = await res.json()
    const exp = body.expense ?? body
    expect(exp.id).toBe(seededExpenseId)
  })

  // ---- pay action ----
  it('pay 401 without a session', async () => {
    const res = await pay.POST(
      await apiRequest('POST', `${base}/${seededExpenseId}/pay`, { body: { amount: 500, payment_date: '2026-01-20', paymentMethod: 'bank' } }) as any,
      ctx(seededExpenseId)
    )
    expect(res.status).toBe(401)
  })
  it('pay 403 for an admin lacking financial:write', async () => {
    const res = await pay.POST(
      await apiRequest('POST', `${base}/${seededExpenseId}/pay`, { sid: narrowSid, body: { amount: 500, payment_date: '2026-01-20', paymentMethod: 'bank' } }) as any,
      ctx(seededExpenseId)
    )
    expect(res.status).toBe(403)
  })
  it('pay 400 when amount/payment_date missing', async () => {
    const res = await pay.POST(
      await apiRequest('POST', `${base}/${seededExpenseId}/pay`, { sid: fullSid, body: { paymentMethod: 'bank' } }) as any,
      ctx(seededExpenseId)
    )
    expect(res.status).toBe(400)
  })
  it('pay 404 for an unknown expense', async () => {
    const missing = uid()
    const res = await pay.POST(
      await apiRequest('POST', `${base}/${missing}/pay`, { sid: fullSid, body: { amount: 500, payment_date: '2026-01-20', paymentMethod: 'bank' } }) as any,
      ctx(missing)
    )
    expect(res.status).toBe(404)
  })
  it('pay records a payment and marks the expense paid when fully covered', async () => {
    const res = await pay.POST(
      await apiRequest('POST', `${base}/${seededExpenseId}/pay`, {
        sid: fullSid,
        body: { amount: 1000, payment_date: '2026-01-20', paymentMethod: 'bank', payment_method: 'bank' },
      }) as any,
      ctx(seededExpenseId)
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.new_status).toBe('paid')
    expect(Number(body.total_paid)).toBe(1000)

    const pmts = await db.query<{ amount: string }>(`SELECT amount FROM expense_payments WHERE expense_id = $1`, [seededExpenseId])
    expect(pmts.rows.length).toBe(1)
    expect(Number(pmts.rows[0].amount)).toBe(1000)
    const exp = await db.query<{ status: string }>(`SELECT status FROM expenses WHERE id = $1`, [seededExpenseId])
    expect(exp.rows[0].status).toBe('paid')
  })
})
