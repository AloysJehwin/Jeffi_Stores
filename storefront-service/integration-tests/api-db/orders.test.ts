// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront (public) orders routes.
// Covers the DB-direct read/write routes: GET /orders (list), GET/DELETE /orders/[id] (detail, cart-restore delete).
// Routes that hit external providers (track → Delhivery, cancel/refund/invoice, create-direct/draft → shipping+payment)
// are only exercised on their pre-provider guard paths (401/404) or skipped — see notes at the bottom of this file.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('storefront orders API (real DB)', () => {
  let listGET: (req: any) => Promise<Response>
  let detailGET: (req: any, ctx: any) => Promise<Response>
  let detailDELETE: (req: any, ctx: any) => Promise<Response>
  let trackGET: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId
  const p1 = FIXTURES.product1
  const p2 = FIXTURES.product2

  // Per-file seeded order ids (unique to avoid cross-file collisions).
  const sfx = uniqueSuffix()
  const confirmedId = `00000000-0000-4000-c111-${sfx.slice(0, 12)}`
  const draftId = `00000000-0000-4000-c222-${sfx.slice(0, 12)}`
  const deletableId = `00000000-0000-4000-c333-${sfx.slice(0, 12)}`
  const otherUserId = `00000000-0000-4000-c444-${sfx.slice(0, 12)}`
  const otherOrderId = `00000000-0000-4000-c555-${sfx.slice(0, 12)}`
  const allOrderIds = [confirmedId, draftId, deletableId, otherOrderId]

  async function seedOrder(id: string, uid: string | null, status: string, paymentStatus: string, num: string) {
    await db.query(
      `INSERT INTO orders (id, order_number, user_id, customer_email, customer_phone, customer_name,
        status, payment_status, subtotal, total_amount, source, payment_mode)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'online','razorpay')`,
      [id, num, uid, 'apitest-customer@jeffi.test', null, 'API Customer', status, paymentStatus, 100, 100]
    )
  }

  async function seedItem(orderId: string, productId: string, name: string, qty: number, price: number) {
    await db.query(
      `INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, total_price, buy_mode, is_digital)
       VALUES ($1,$2,$3,$4,$5,$6,'unit',false)`,
      [orderId, productId, name, qty, price, price * qty]
    )
  }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    listGET = (await import('@storefront/app/api/(public)/orders/route')).GET as any
    const detail = await import('@storefront/app/api/(public)/orders/[id]/route')
    detailGET = detail.GET as any
    detailDELETE = detail.DELETE as any
    trackGET = (await import('@storefront/app/api/(public)/orders/[id]/track/route')).GET as any
    ;({ sid } = await makeCustomerSession(auth, userId))

    // A second user that owns otherOrderId — proves ownership scoping (404 for our customer).
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, is_active) VALUES ($1,$2,'Other','User',true)`,
      [otherUserId, `other-${sfx}@jeffi.test`]
    )

    // Clean leftover rows from a prior run, then seed fresh.
    await db.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [allOrderIds]).catch(() => {})
    await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [allOrderIds]).catch(() => {})
    await db.query(`DELETE FROM cart_items WHERE user_id = $1 AND product_id = ANY($2::uuid[])`, [userId, [p1, p2]]).catch(() => {})

    await seedOrder(confirmedId, userId, 'confirmed', 'paid', `ORD-SFT-${sfx}-A`)
    await seedItem(confirmedId, p1, 'API Test Bolt', 2, 50)
    await seedOrder(draftId, userId, 'draft', 'unpaid', `ORD-SFT-${sfx}-D`)
    await seedOrder(deletableId, userId, 'pending', 'unpaid', `ORD-SFT-${sfx}-X`)
    await seedItem(deletableId, p1, 'API Test Bolt', 3, 50)
    await seedItem(deletableId, p2, 'API Test Nut', 1, 25)
    await seedOrder(otherOrderId, otherUserId, 'confirmed', 'paid', `ORD-SFT-${sfx}-O`)
  })

  afterAll(async () => {
    await db.query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [allOrderIds]).catch(() => {})
    await db.query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [allOrderIds]).catch(() => {})
    await db.query(`DELETE FROM cart_items WHERE user_id = $1 AND product_id = ANY($2::uuid[])`, [userId, [p1, p2]]).catch(() => {})
    await db.query(`DELETE FROM users WHERE id = $1`, [otherUserId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='customer'`, [userId]).catch(() => {})
    await endPool()
  })

  // ---- GET /orders (list) ----

  it('GET /orders 401 without a session', async () => {
    const res = await listGET(await apiRequest('GET', 'http://localhost/api/orders') as any)
    expect(res.status).toBe(401)
  })

  it('GET /orders returns the customer orders, excluding drafts', async () => {
    const res = await listGET(await apiRequest('GET', 'http://localhost/api/orders', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.orders)).toBe(true)
    const ids = body.orders.map((o: any) => o.id)
    expect(ids).toContain(confirmedId)
    expect(ids).toContain(deletableId)
    // Draft is filtered by `status != 'draft'`, and the other user's order never matches.
    expect(ids).not.toContain(draftId)
    expect(ids).not.toContain(otherOrderId)
    // The confirmed order carries its seeded item.
    const confirmed = body.orders.find((o: any) => o.id === confirmedId)
    expect(confirmed.order_items.length).toBe(1)
    expect(confirmed.order_items[0].product_id).toBe(p1)
    expect(Number(confirmed.order_items[0].quantity)).toBe(2)
  })

  it('GET /orders paginates (page=2 of our seeded set is empty but well-formed)', async () => {
    const res = await listGET(await apiRequest('GET', 'http://localhost/api/orders?page=2', { sid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.page).toBe(2)
    expect(body.pageSize).toBe(10)
    expect(typeof body.total).toBe('number')
  })

  // ---- GET /orders/[id] (detail) ----

  it('GET /orders/[id] 401 without a session', async () => {
    const res = await detailGET(await apiRequest('GET', `http://localhost/api/orders/${confirmedId}`) as any, {
      params: Promise.resolve({ id: confirmedId }),
    })
    expect(res.status).toBe(401)
  })

  it('GET /orders/[id] 404 for an order owned by another user', async () => {
    const res = await detailGET(await apiRequest('GET', `http://localhost/api/orders/${otherOrderId}`, { sid }) as any, {
      params: Promise.resolve({ id: otherOrderId }),
    })
    expect(res.status).toBe(404)
  })

  it('GET /orders/[id] 404 for a draft (hidden by status != draft)', async () => {
    const res = await detailGET(await apiRequest('GET', `http://localhost/api/orders/${draftId}`, { sid }) as any, {
      params: Promise.resolve({ id: draftId }),
    })
    expect(res.status).toBe(404)
  })

  it('GET /orders/[id] returns the real order with items for the owner', async () => {
    const res = await detailGET(await apiRequest('GET', `http://localhost/api/orders/${confirmedId}`, { sid }) as any, {
      params: Promise.resolve({ id: confirmedId }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order.id).toBe(confirmedId)
    expect(body.order.status).toBe('confirmed')
    expect(body.order.paymentStatus).toBe('paid')
    expect(body.order.totalAmount).toBe(100)
    expect(body.order.items.length).toBe(1)
    expect(body.order.items[0].productId).toBe(p1)
    // detail route returns quantity straight from numeric(10,3) → string '2.000'
    expect(Number(body.order.items[0].quantity)).toBe(2)
  })

  // ---- DELETE /orders/[id] (delete pending/unpaid + restore to cart) ----

  it('DELETE /orders/[id] 401 without a session', async () => {
    const res = await detailDELETE(await apiRequest('DELETE', `http://localhost/api/orders/${deletableId}`) as any, {
      params: Promise.resolve({ id: deletableId }),
    })
    expect(res.status).toBe(401)
  })

  it('DELETE /orders/[id] 404 for a non-owned order', async () => {
    const res = await detailDELETE(await apiRequest('DELETE', `http://localhost/api/orders/${otherOrderId}`, { sid }) as any, {
      params: Promise.resolve({ id: otherOrderId }),
    })
    expect(res.status).toBe(404)
  })

  it('DELETE /orders/[id] 400 when the order is not in a deletable state (confirmed+paid)', async () => {
    const res = await detailDELETE(await apiRequest('DELETE', `http://localhost/api/orders/${confirmedId}`, { sid }) as any, {
      params: Promise.resolve({ id: confirmedId }),
    })
    expect(res.status).toBe(400)
    // Real side-effect check: the order still exists (nothing deleted).
    const row = await db.queryOne('SELECT id FROM orders WHERE id = $1', [confirmedId])
    expect(row).toBeTruthy()
  })

  it('DELETE /orders/[id] removes a pending/unpaid order and restores its items to the cart', async () => {
    const res = await detailDELETE(await apiRequest('DELETE', `http://localhost/api/orders/${deletableId}`, { sid }) as any, {
      params: Promise.resolve({ id: deletableId }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(true)
    // The order row is gone.
    const gone = await db.queryOne('SELECT id FROM orders WHERE id = $1', [deletableId])
    expect(gone).toBeNull()
    // Both non-digital items are back in the cart for this user.
    const cart = await db.queryMany<{ product_id: string; quantity: string }>(
      'SELECT product_id, quantity FROM cart_items WHERE user_id = $1 AND product_id = ANY($2::uuid[])',
      [userId, [p1, p2]]
    )
    const cartIds = cart.map(c => c.product_id)
    expect(cartIds).toContain(p1)
    expect(cartIds).toContain(p2)
    const bolt = cart.find(c => c.product_id === p1)
    expect(Number(bolt!.quantity)).toBe(3)
  })

  // ---- GET /orders/[id]/track (pre-provider guards only; trackOrder → Delhivery is external) ----

  it('GET /orders/[id]/track 401 without a session', async () => {
    const res = await trackGET(await apiRequest('GET', `http://localhost/api/orders/${confirmedId}/track`) as any, {
      params: Promise.resolve({ id: confirmedId }),
    })
    expect(res.status).toBe(401)
  })

  it('GET /orders/[id]/track 404 for a non-owned order (before any courier call)', async () => {
    const res = await trackGET(await apiRequest('GET', `http://localhost/api/orders/${otherOrderId}/track`, { sid }) as any, {
      params: Promise.resolve({ id: otherOrderId }),
    })
    expect(res.status).toBe(404)
  })
})
