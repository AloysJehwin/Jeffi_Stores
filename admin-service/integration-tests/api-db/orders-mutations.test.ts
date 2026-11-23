// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — admin orders MUTATION routes that read/write Postgres directly.
// Real authenticateAdmin → resolveSession → hasScope chain; real UPDATE / audit side-effects verified back
// against the DB. Covered: [id] PATCH (notes), [id]/payment-status PATCH, [id]/entitlements POST (validation).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin orders mutation API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let orderPATCH: (req: any, ctx: any) => Promise<Response>
  let paymentStatusPATCH: (req: any, ctx: any) => Promise<Response>
  let entitlementsPOST: (req: any, ctx: any) => Promise<Response>

  let fullSid = ''
  let narrowSid = ''
  // A writer (has orders:write) that is NOT a platform owner — exercises the override gate (super-admin only).
  let writerSid = ''

  const sfx = uniqueSuffix()
  const orderId = `00000000-0000-4000-d100-${sfx.padEnd(12, '0').slice(0, 12)}`
  const orderNumber = `APITM-${sfx}`

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    orderPATCH = (await import('@admin/app/api/(admin)/admin/orders/[id]/route')).PATCH as any
    paymentStatusPATCH = (await import('@admin/app/api/(admin)/admin/orders/[id]/payment-status/route')).PATCH as any
    entitlementsPOST = (await import('@admin/app/api/(admin)/admin/orders/[id]/entitlements/route')).POST as any

    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    ;({ sid: writerSid } = await makeAdminSession(auth, FIXTURES.adminId, ['orders:write'], 'manager'))
  })

  // Reset the order to a known state before every test so transition rules are deterministic.
  beforeEach(async () => {
    await db.query(`DELETE FROM orders WHERE id = $1`, [orderId]).catch(() => {})
    await db.query(
      `INSERT INTO orders (id, order_number, user_id, status, payment_status, subtotal, total_amount, source, payment_mode)
       VALUES ($1,$2,$3,'confirmed','unpaid',100.00,100.00,'online','cash')`,
      [orderId, orderNumber, FIXTURES.customerId]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM orders WHERE id = $1`, [orderId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // ---- [id] PATCH (orders:write) — notes-only avoids ads/mail/marketplace side effects ----
  describe('PATCH /orders/[id]', () => {
    it('401 without a session', async () => {
      const res = await orderPATCH(await apiRequest('PATCH', `http://localhost/api/admin/orders/${orderId}`, { body: { notes: 'x' } }) as any, ctx(orderId))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:write', async () => {
      const res = await orderPATCH(await apiRequest('PATCH', `http://localhost/api/admin/orders/${orderId}`, { sid: narrowSid, body: { notes: 'x' } }) as any, ctx(orderId))
      expect(res.status).toBe(403)
    })
    it('400 on an empty body (at least one field required)', async () => {
      const res = await orderPATCH(await apiRequest('PATCH', `http://localhost/api/admin/orders/${orderId}`, { sid: fullSid, body: {} }) as any, ctx(orderId))
      expect(res.status).toBe(400)
    })
    it('200 writes notes to the real row', async () => {
      const note = `handled ${sfx}`
      const res = await orderPATCH(await apiRequest('PATCH', `http://localhost/api/admin/orders/${orderId}`, { sid: fullSid, body: { notes: note } }) as any, ctx(orderId))
      expect(res.status).toBe(200)
      const row = await db.queryOne<{ notes: string }>(`SELECT notes FROM orders WHERE id = $1`, [orderId])
      expect(row!.notes).toBe(note)
    })
  })

  // ---- [id]/payment-status PATCH (orders:write) ----
  describe('PATCH /orders/[id]/payment-status', () => {
    const url = `http://localhost/api/admin/orders/${orderId}/payment-status`

    it('401 without a session', async () => {
      const res = await paymentStatusPATCH(await apiRequest('PATCH', url, { body: { payment_status: 'paid' } }) as any, ctx(orderId))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:write', async () => {
      const res = await paymentStatusPATCH(await apiRequest('PATCH', url, { sid: narrowSid, body: { payment_status: 'paid' } }) as any, ctx(orderId))
      expect(res.status).toBe(403)
    })
    it('400 for an invalid payment_status', async () => {
      const res = await paymentStatusPATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { payment_status: 'bogus' } }) as any, ctx(orderId))
      expect(res.status).toBe(400)
    })
    it('404 for an unknown order id', async () => {
      const unknown = '00000000-0000-4000-d100-0000deadbeef'
      const res = await paymentStatusPATCH(await apiRequest('PATCH', `http://localhost/api/admin/orders/${unknown}/payment-status`, { sid: fullSid, body: { payment_status: 'paid' } }) as any, ctx(unknown))
      expect(res.status).toBe(404)
    })
    it('403 when a non-platform writer tries to override', async () => {
      const res = await paymentStatusPATCH(await apiRequest('PATCH', url, { sid: writerSid, body: { payment_status: 'refunded', override: true, override_reason: 'customer disputed charge' } }) as any, ctx(orderId))
      expect(res.status).toBe(403)
    })
    it('200 moves unpaid → paid and persists it', async () => {
      const res = await paymentStatusPATCH(await apiRequest('PATCH', url, { sid: fullSid, body: { payment_status: 'paid' } }) as any, ctx(orderId))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      const row = await db.queryOne<{ payment_status: string }>(`SELECT payment_status FROM orders WHERE id = $1`, [orderId])
      expect(row!.payment_status).toBe('paid')
    })
  })

  // ---- [id]/entitlements POST (orders:write) — validation + guard paths, no provider calls ----
  describe('POST /orders/[id]/entitlements', () => {
    const url = `http://localhost/api/admin/orders/${orderId}/entitlements`

    it('401 without a session', async () => {
      const res = await entitlementsPOST(await apiRequest('POST', url, { body: { action: 'revoke' } }) as any, ctx(orderId))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:write', async () => {
      const res = await entitlementsPOST(await apiRequest('POST', url, { sid: narrowSid, body: { action: 'revoke' } }) as any, ctx(orderId))
      expect(res.status).toBe(403)
    })
    it('400 for an invalid action', async () => {
      const res = await entitlementsPOST(await apiRequest('POST', url, { sid: fullSid, body: { action: 'nope' } }) as any, ctx(orderId))
      expect(res.status).toBe(400)
    })
    it('404 for an unknown order id', async () => {
      const unknown = '00000000-0000-4000-d100-0000cafebabe'
      const res = await entitlementsPOST(await apiRequest('POST', `http://localhost/api/admin/orders/${unknown}/entitlements`, { sid: fullSid, body: { action: 'revoke' } }) as any, ctx(unknown))
      expect(res.status).toBe(404)
    })
    it('400 when granting access on an unpaid order', async () => {
      // Seeded order is unpaid → grant must be rejected before any entitlement write.
      const res = await entitlementsPOST(await apiRequest('POST', url, { sid: fullSid, body: { action: 'grant' } }) as any, ctx(orderId))
      expect(res.status).toBe(400)
    })
  })
})
