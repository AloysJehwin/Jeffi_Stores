// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — admin orders READ routes. Every route goes through the real
// authenticateAdmin → resolveSession → hasScope chain against seeded admin sessions, then reads real rows.
// Covered: by-number, [id] GET, revenue-trend, overview, [id]/mail-logs, [id]/adjustments GET, [id]/entitlements GET.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin orders read API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let byNumberGET: (req: any) => Promise<Response>
  let orderGET: (req: any, ctx: any) => Promise<Response>
  let trendGET: (req: any) => Promise<Response>
  let overviewGET: (req: any) => Promise<Response>
  let mailLogsGET: (req: any, ctx: any) => Promise<Response>
  let adjustmentsGET: (req: any, ctx: any) => Promise<Response>
  let entitlementsGET: (req: any, ctx: any) => Promise<Response>

  let fullSid = ''
  let narrowSid = ''

  // Seeded rows (crypto-random ids, cleaned up in afterAll).
  const sfx = uniqueSuffix()
  const orderId = `00000000-0000-4000-d000-${sfx.padEnd(12, '0').slice(0, 12)}`
  const orderNumber = `APIT-${sfx}`
  const itemId = `00000000-0000-4000-e000-${sfx.padEnd(12, '0').slice(0, 12)}`
  const adjId = `00000000-0000-4000-f000-${sfx.padEnd(12, '0').slice(0, 12)}`
  let mailLogId = ''

  const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    byNumberGET = (await import('@admin/app/api/(admin)/admin/orders/by-number/route')).GET as any
    orderGET = (await import('@admin/app/api/(admin)/admin/orders/[id]/route')).GET as any
    trendGET = (await import('@admin/app/api/(admin)/admin/orders/revenue-trend/route')).GET as any
    overviewGET = (await import('@admin/app/api/(admin)/admin/orders/overview/route')).GET as any
    mailLogsGET = (await import('@admin/app/api/(admin)/admin/orders/[id]/mail-logs/route')).GET as any
    adjustmentsGET = (await import('@admin/app/api/(admin)/admin/orders/[id]/adjustments/route')).GET as any
    entitlementsGET = (await import('@admin/app/api/(admin)/admin/orders/[id]/entitlements/route')).GET as any

    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    // Narrow non-platform admin whose scopes lack orders:read → 403.
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))

    // An order with one (digital) item, plus one adjustment and one mail-log referencing it.
    await db.query(
      `INSERT INTO orders (id, order_number, user_id, status, payment_status, subtotal, total_amount, source, payment_mode)
       VALUES ($1,$2,$3,'confirmed','unpaid',100.00,100.00,'online','cash')`,
      [orderId, orderNumber, FIXTURES.customerId]
    )
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price, is_digital)
       VALUES ($1,$2,$3,'API Test Bolt',1,100.00,100.00,TRUE)`,
      [itemId, orderId, FIXTURES.product1]
    )
    await db.query(
      `INSERT INTO order_adjustments (id, order_id, status, settlement_type, net_diff, old_subtotal, new_subtotal, old_total, new_total)
       VALUES ($1,$2,'applied','refund',-10.00,100.00,90.00,100.00,90.00)`,
      [adjId, orderId]
    )
    const log = await db.queryOne<{ id: string }>(
      `INSERT INTO email_logs (email, subject, template_name, kind, status, entity_type, entity_id)
       VALUES ('apitest-customer@jeffi.test','Order mail','order_confirmation','order','sent','orders',$1) RETURNING id`,
      [orderId]
    )
    mailLogId = log!.id
  })

  afterAll(async () => {
    await db.query(`DELETE FROM email_logs WHERE id = $1`, [mailLogId]).catch(() => {})
    await db.query(`DELETE FROM order_adjustments WHERE id = $1`, [adjId]).catch(() => {})
    await db.query(`DELETE FROM order_items WHERE id = $1`, [itemId]).catch(() => {})
    await db.query(`DELETE FROM orders WHERE id = $1`, [orderId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // ---- by-number (GET, orders:read) ----
  describe('GET /orders/by-number', () => {
    const url = (q: string) => `http://localhost/api/admin/orders/by-number?q=${encodeURIComponent(q)}`

    it('401 without a session', async () => {
      const res = await byNumberGET(await apiRequest('GET', url(orderNumber)) as any)
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:read', async () => {
      const res = await byNumberGET(await apiRequest('GET', url(orderNumber), { sid: narrowSid }) as any)
      expect(res.status).toBe(403)
    })
    it('400 when q is missing', async () => {
      const res = await byNumberGET(await apiRequest('GET', 'http://localhost/api/admin/orders/by-number', { sid: fullSid }) as any)
      expect(res.status).toBe(400)
    })
    it('404 when no order matches', async () => {
      const res = await byNumberGET(await apiRequest('GET', url('NO-SUCH-ORDER'), { sid: fullSid }) as any)
      expect(res.status).toBe(404)
    })
    it('200 returns the seeded order by number', async () => {
      const res = await byNumberGET(await apiRequest('GET', url(orderNumber), { sid: fullSid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.order.id).toBe(orderId)
      expect(body.order.order_number).toBe(orderNumber)
      expect(body.order.payment_status).toBe('unpaid')
    })
  })

  // ---- [id] GET (orders:read) ----
  describe('GET /orders/[id]', () => {
    it('401 without a session', async () => {
      const res = await orderGET(await apiRequest('GET', `http://localhost/api/admin/orders/${orderId}`) as any, ctx(orderId))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:read', async () => {
      const res = await orderGET(await apiRequest('GET', `http://localhost/api/admin/orders/${orderId}`, { sid: narrowSid }) as any, ctx(orderId))
      expect(res.status).toBe(403)
    })
    it('404 for an unknown order id', async () => {
      const unknown = '00000000-0000-4000-d000-0000deadbeef'
      const res = await orderGET(await apiRequest('GET', `http://localhost/api/admin/orders/${unknown}`, { sid: fullSid }) as any, ctx(unknown))
      expect(res.status).toBe(404)
    })
    it('200 returns the order with its items', async () => {
      const res = await orderGET(await apiRequest('GET', `http://localhost/api/admin/orders/${orderId}`, { sid: fullSid }) as any, ctx(orderId))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.order.id).toBe(orderId)
      expect(Array.isArray(body.items)).toBe(true)
      expect(body.items.map((i: any) => i.id)).toContain(itemId)
    })
  })

  // ---- revenue-trend (GET, orders:read) ----
  describe('GET /orders/revenue-trend', () => {
    const url = 'http://localhost/api/admin/orders/revenue-trend?period=12m'
    it('401 without a session', async () => {
      const res = await trendGET(await apiRequest('GET', url) as any)
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:read', async () => {
      const res = await trendGET(await apiRequest('GET', url, { sid: narrowSid }) as any)
      expect(res.status).toBe(403)
    })
    it('200 returns a trend series (invalid period falls back to 12m)', async () => {
      const res = await trendGET(await apiRequest('GET', 'http://localhost/api/admin/orders/revenue-trend?period=bogus', { sid: fullSid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.period).toBe('12m')
      // RevenueTrend is { months, series } over a continuous month axis.
      expect(Array.isArray(body.trend.months)).toBe(true)
      expect(Array.isArray(body.trend.series)).toBe(true)
    })
  })

  // ---- overview (GET, orders:read via requireAdminScope) ----
  describe('GET /orders/overview', () => {
    const url = 'http://localhost/api/admin/orders/overview'
    it('401 without a session', async () => {
      const res = await overviewGET(await apiRequest('GET', url) as any)
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:read', async () => {
      const res = await overviewGET(await apiRequest('GET', url, { sid: narrowSid }) as any)
      expect(res.status).toBe(403)
    })
    it('200 returns the overview shape against real orders', async () => {
      const res = await overviewGET(await apiRequest('GET', url, { sid: fullSid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveProperty('kpis')
      expect(body).toHaveProperty('pipeline')
      expect(body).toHaveProperty('snapshot')
      expect(Array.isArray(body.pipeline)).toBe(true)
    })
  })

  // ---- [id]/mail-logs (GET, orders:read) ----
  describe('GET /orders/[id]/mail-logs', () => {
    const url = `http://localhost/api/admin/orders/${orderId}/mail-logs`
    it('401 without a session', async () => {
      const res = await mailLogsGET(await apiRequest('GET', url) as any, ctx(orderId))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:read', async () => {
      const res = await mailLogsGET(await apiRequest('GET', url, { sid: narrowSid }) as any, ctx(orderId))
      expect(res.status).toBe(403)
    })
    it('200 returns the seeded mail log for the order', async () => {
      const res = await mailLogsGET(await apiRequest('GET', url, { sid: fullSid }) as any, ctx(orderId))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.logs.map((l: any) => l.id)).toContain(mailLogId)
      expect(body.logs[0].template_name).toBe('order_confirmation')
    })
  })

  // ---- [id]/adjustments (GET, orders:read) ----
  describe('GET /orders/[id]/adjustments', () => {
    const url = `http://localhost/api/admin/orders/${orderId}/adjustments`
    it('401 without a session', async () => {
      const res = await adjustmentsGET(await apiRequest('GET', url) as any, ctx(orderId))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:read', async () => {
      const res = await adjustmentsGET(await apiRequest('GET', url, { sid: narrowSid }) as any, ctx(orderId))
      expect(res.status).toBe(403)
    })
    it('200 returns the seeded adjustment in history', async () => {
      const res = await adjustmentsGET(await apiRequest('GET', url, { sid: fullSid }) as any, ctx(orderId))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.history)).toBe(true)
      expect(body.history.map((h: any) => h.id)).toContain(adjId)
    })
  })

  // ---- [id]/entitlements (GET, orders:read) ----
  describe('GET /orders/[id]/entitlements', () => {
    const url = `http://localhost/api/admin/orders/${orderId}/entitlements`
    it('401 without a session', async () => {
      const res = await entitlementsGET(await apiRequest('GET', url) as any, ctx(orderId))
      expect(res.status).toBe(401)
    })
    it('403 for an admin lacking orders:read', async () => {
      const res = await entitlementsGET(await apiRequest('GET', url, { sid: narrowSid }) as any, ctx(orderId))
      expect(res.status).toBe(403)
    })
    it('200 lists the digital line entitlements', async () => {
      const res = await entitlementsGET(await apiRequest('GET', url, { sid: fullSid }) as any, ctx(orderId))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(Array.isArray(body.entitlements)).toBe(true)
      // The seeded digital order_item surfaces as an entitlement row.
      expect(body.entitlements.map((e: any) => e.order_item_id)).toContain(itemId)
    })
  })
})
