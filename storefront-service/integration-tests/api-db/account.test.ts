// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — storefront (public) /account route group:
//   account/buy-again, account/coupons, account/delete.
// Real customer session (resolveSession), real handlers, real SQL side-effects asserted against jeffi_test.
// Opt-in via API_DB=1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('account API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId
  const suffix = uniqueSuffix() // 12 hex chars → the final uuid group
  // Dedicated rows this file owns (cleaned in afterAll). Valid v4-shaped uuids with a per-file suffix tail.
  const orderId = `00000000-0000-4000-c000-${suffix}`
  const couponUsableId = `00000000-0000-4000-d000-${suffix}`
  const couponExpiredId = `00000000-0000-4000-d001-${suffix}`

  // buy-again
  let BG_GET: (req: any) => Promise<Response>
  // coupons
  let CP_GET: (req: any) => Promise<Response>
  // delete
  let DL_GET: (req: any) => Promise<Response>
  let DL_POST: (req: any) => Promise<Response>

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    ;({ sid } = await makeCustomerSession(auth, userId))

    BG_GET = (await import('@storefront/app/api/(public)/account/buy-again/route')).GET as any
    CP_GET = (await import('@storefront/app/api/(public)/account/coupons/route')).GET as any
    const del = await import('@storefront/app/api/(public)/account/delete/route')
    DL_GET = del.GET as any
    DL_POST = del.POST as any

    // Seed one delivered order with product1 so buy-again has a deterministic hit.
    await db.query(
      `INSERT INTO orders (id, order_number, user_id, status, payment_status, subtotal, total_amount)
       VALUES ($1, $2, $3, 'delivered', 'paid', 100, 100)`,
      [orderId, `API-BG-${suffix.slice(0, 8)}`, userId]
    )
    await db.query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price)
       VALUES ($1, $2, 'API Test Bolt', 1, 100, 100)`,
      [orderId, FIXTURES.product1]
    )

    // Seed one usable + one expired personal coupon for this customer.
    await db.query(
      `INSERT INTO coupons (id, code, description, discount_type, discount_value, is_active, is_draft,
                            generated_for_user_id, generated_for_campaign, created_at)
       VALUES ($1, $2, 'Usable test coupon', 'fixed', 50, TRUE, FALSE, $3, 'store', now())`,
      [couponUsableId, `APIUSABLE${suffix.slice(0, 6).toUpperCase()}`, userId]
    )
    await db.query(
      `INSERT INTO coupons (id, code, description, discount_type, discount_value, is_active, is_draft,
                            valid_until, generated_for_user_id, generated_for_campaign, created_at)
       VALUES ($1, $2, 'Expired test coupon', 'fixed', 10, TRUE, FALSE, now() - interval '1 day', $3, 'store', now())`,
      [couponExpiredId, `APIEXPIRE${suffix.slice(0, 6).toUpperCase()}`, userId]
    )
  })

  afterAll(async () => {
    await db.query('DELETE FROM order_items WHERE order_id = $1', [orderId]).catch(() => {})
    await db.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {})
    await db.query('DELETE FROM coupons WHERE id = ANY($1::uuid[])', [[couponUsableId, couponExpiredId]]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='customer'`, [userId]).catch(() => {})
    await endPool()
  })

  // ---- account/buy-again (authenticateAnyUser) ----

  it('buy-again: 401 without a session', async () => {
    const res = await BG_GET(await apiRequest('GET', 'http://localhost/api/account/buy-again') as any)
    expect(res.status).toBe(401)
  })

  it('buy-again: 200 returns the product from the seeded delivered order', async () => {
    const res = await BG_GET(await apiRequest('GET', 'http://localhost/api/account/buy-again', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.products)).toBe(true)
    const ids = body.products.map((p: any) => p.id)
    expect(ids).toContain(FIXTURES.product1)
  })

  // ---- account/coupons (authenticateAnyUser) ----

  it('coupons: 401 without a session', async () => {
    const res = await CP_GET(await apiRequest('GET', 'http://localhost/api/account/coupons') as any)
    expect(res.status).toBe(401)
  })

  it('coupons: 200 lists the customer coupons with status', async () => {
    const res = await CP_GET(await apiRequest('GET', 'http://localhost/api/account/coupons', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.coupons)).toBe(true)
    const byId = new Map<string, any>(body.coupons.map((c: any) => [c.id, c]))
    expect(byId.get(couponUsableId)?.status).toBe('usable')
    expect(byId.get(couponExpiredId)?.status).toBe('expired')
  })

  it('coupons: ?status=usable hides the expired coupon', async () => {
    const res = await CP_GET(await apiRequest('GET', 'http://localhost/api/account/coupons?status=usable', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.coupons.map((c: any) => c.id)
    expect(ids).toContain(couponUsableId)
    expect(ids).not.toContain(couponExpiredId)
  })

  // ---- account/delete (authenticateUser; POST happy path skipped — destructive + S3/OTP side effects) ----

  it('delete: GET 401 without a session', async () => {
    const res = await DL_GET(await apiRequest('GET', 'http://localhost/api/account/delete') as any)
    expect(res.status).toBe(401)
  })

  it('delete: GET 200 returns blockers + retainedOrders (seeded order is retained, not a blocker)', async () => {
    const res = await DL_GET(await apiRequest('GET', 'http://localhost/api/account/delete', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.blockers)).toBe(true)
    expect(typeof body.retainedOrders).toBe('number')
    // The delivered order counts toward retainedOrders and is not an open-order blocker.
    expect(body.retainedOrders).toBeGreaterThanOrEqual(1)
    expect(body.blockers.some((b: any) => b.kind === 'open_orders')).toBe(false)
  })

  it('delete: POST 401 without a session', async () => {
    const res = await DL_POST(await apiRequest('POST', 'http://localhost/api/account/delete', { body: { confirm: 'DELETE' } }) as any)
    expect(res.status).toBe(401)
  })

  it('delete: POST 400 when confirm is not "DELETE" (no account mutated)', async () => {
    const res = await DL_POST(await apiRequest('POST', 'http://localhost/api/account/delete', { sid, body: { confirm: 'nope' } }) as any)
    expect(res.status).toBe(400)
    // Real assertion: the fixture user was NOT soft-deleted by the rejected request.
    const row = await db.queryOne<{ deleted_at: string | null }>('SELECT deleted_at FROM users WHERE id = $1', [userId])
    expect(row?.deleted_at).toBeNull()
  })
})
