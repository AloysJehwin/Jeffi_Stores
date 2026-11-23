// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront checkout intents.
// POST /api/checkout/intents (sign) and GET /api/checkout/intents/[token] (verify + resolve).
// Real buyNow resolution reads products from jeffi_test; cart mode reads cart_items via a real
// customer session. The intent token is a real HS256 JWT (CHECKOUT_INTENT_SECRET→JWT_SECRET from
// vitest.db.config), so POST→GET round-trips the actual signed token. Opt-in via API_DB=1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('checkout intents API (real DB)', () => {
  let POST: (req: any) => Promise<Response>
  let GET: (req: any, ctx: { params: Promise<{ token: string }> }) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let sid = ''
  const userId = FIXTURES.customerId
  const product1 = FIXTURES.product1
  const product2 = FIXTURES.product2

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const createRoute = await import('@storefront/app/api/(public)/checkout/intents/route')
    const readRoute = await import('@storefront/app/api/(public)/checkout/intents/[token]/route')
    POST = createRoute.POST as any
    GET = readRoute.GET as any
    ;({ sid } = await makeCustomerSession(auth, userId))
    // Start from a known-empty cart for this fixture user.
    await db.query('DELETE FROM cart_items WHERE user_id = $1', [userId])
  })

  afterAll(async () => {
    await db.query('DELETE FROM cart_items WHERE user_id = $1', [userId]).catch(() => {})
    await endPool()
  })

  const ctx = (token: string) => ({ params: Promise.resolve({ token }) })

  // ---- POST (buyNow: no auth required) ----

  it('POST buyNow returns a signed intent token for an active product', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      body: { productId: product1, qty: 2 },
    }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.intent).toBe('string')
    expect(body.intent.length).toBeGreaterThan(20)
  })

  it('POST buyNow with missing productId/qty returns 400', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      body: { mode: 'buyNow' },
    }) as any)
    expect(res.status).toBe(400)
  })

  it('POST buyNow with a non-existent product returns 400', async () => {
    const missing = '00000000-0000-4000-b000-0000000000ff'
    const res = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      body: { productId: missing, qty: 1 },
    }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/not found|inactive/i)
  })

  it('POST buyNow with an invalid (non-uuid) productId returns 400 (schema validation)', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      body: { productId: 'not-a-uuid', qty: 1 },
    }) as any)
    expect(res.status).toBe(400)
  })

  it('POST buyNow with qty <= 0 returns 400', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      body: { productId: product1, qty: 0 },
    }) as any)
    expect(res.status).toBe(400)
  })

  // ---- POST (cart: auth + non-empty cart required) ----

  it('POST cart without a session returns 401', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      body: { mode: 'cart' },
    }) as any)
    expect(res.status).toBe(401)
  })

  it('POST cart with an empty cart returns 400', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      sid, body: { mode: 'cart' },
    }) as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/empty/i)
  })

  it('POST cart with a real cart row returns an intent token', async () => {
    await db.query(
      `INSERT INTO cart_items (user_id, product_id, quantity, price_at_addition, buy_mode)
       VALUES ($1, $2, 3, 100.00, 'unit')`,
      [userId, product1]
    )
    const res = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      sid, body: { mode: 'cart' },
    }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.intent).toBe('string')
  })

  // ---- GET [token] ----

  it('GET with an invalid token returns 400', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/checkout/intents/bad.token', {}) as any, ctx('bad.token'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/invalid|expired/i)
  })

  it('GET resolves a buyNow token POSTed earlier, reading product display from the DB', async () => {
    // Round-trip: POST produces a real signed token; GET verifies + resolves it.
    const postRes = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      body: { productId: product2, qty: 4 },
    }) as any)
    const { intent } = await postRes.json()
    const res = await GET(await apiRequest('GET', `http://localhost/api/checkout/intents/${intent}`, {}) as any, ctx(intent))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('buyNow')
    expect(body.productId).toBe(product2)
    expect(body.qty).toBe(4)
    // DB side-effect: the display query pulled the seeded product name + sku.
    expect(body.productName).toBe('API Test Nut')
    expect(body.sku).toBe('APITEST-SKU-2')
    expect(typeof body.price).toBe('number')
  })

  it('GET cart token without a session returns 401', async () => {
    // Need a cart to mint a cart token.
    await db.query('DELETE FROM cart_items WHERE user_id = $1', [userId])
    await db.query(
      `INSERT INTO cart_items (user_id, product_id, quantity, price_at_addition, buy_mode)
       VALUES ($1, $2, 1, 100.00, 'unit')`,
      [userId, product1]
    )
    const postRes = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      sid, body: { mode: 'cart' },
    }) as any)
    const { intent } = await postRes.json()
    const res = await GET(await apiRequest('GET', `http://localhost/api/checkout/intents/${intent}`, {}) as any, ctx(intent))
    expect(res.status).toBe(401)
  })

  it('GET cart token for a different user returns 403', async () => {
    // Mint a cart token as the fixture user (cart row inserted in the prior test), then read it
    // with a session for a *different* customer → ownership check fails.
    const postRes = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      sid, body: { mode: 'cart' },
    }) as any)
    const { intent } = await postRes.json()

    const otherId = '00000000-0000-4000-a000-0000000000c9'
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, user_type)
       VALUES ($1, 'apitest-checkout-other@jeffi.test', 'Other', 'Buyer', 'customer')
       ON CONFLICT (id) DO NOTHING`,
      [otherId]
    )
    const auth = await import('@/lib/auth/auth-sessions')
    const { sid: otherSid } = await makeCustomerSession(auth, otherId)

    const res = await GET(await apiRequest('GET', `http://localhost/api/checkout/intents/${intent}`, { sid: otherSid }) as any, ctx(intent))
    expect(res.status).toBe(403)

    await db.query('DELETE FROM users WHERE id = $1', [otherId]).catch(() => {})
  })

  it('GET cart token resolves to cart summary for the owner', async () => {
    const postRes = await POST(await apiRequest('POST', 'http://localhost/api/checkout/intents', {
      sid, body: { mode: 'cart' },
    }) as any)
    const { intent } = await postRes.json()
    const res = await GET(await apiRequest('GET', `http://localhost/api/checkout/intents/${intent}`, { sid }) as any, ctx(intent))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mode).toBe('cart')
    expect(body.itemCount).toBeGreaterThanOrEqual(1)
    expect(typeof body.subtotal).toBe('number')
  })
})
