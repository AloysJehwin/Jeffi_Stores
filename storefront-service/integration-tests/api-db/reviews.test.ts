// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront reviews route group:
//   (public)/reviews            GET (public + authed orderId), POST (formData), PATCH (formData)
//   (public)/reviews/from-token GET + POST (review-token minted via real generateReviewToken)
//   (public)/reviews/amp        POST (AMP form/json, review-token)
// Real customer sessions, real review tokens, real SQL side-effects asserted against jeffi_test.
// SKIPPED: (public)/reviews/generate — needs the AI gateway (aiChat) + storefrontAiGate, external.
// Opt-in via API_DB=1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// Build a NextRequest with a multipart FormData body (reviews POST/PATCH read request.formData()).
async function formRequest(
  method: string,
  url: string,
  fields: Record<string, string>,
  sid?: string
): Promise<any> {
  const { NextRequest } = await import('next/server')
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  const headers: Record<string, string> = {}
  if (sid) headers['Authorization'] = `Bearer ${sid}`
  return new NextRequest(url, { method, headers, body: fd }) as any
}

describe.skipIf(!API_DB_ENABLED)('reviews API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let jwt: typeof import('@/lib/auth/jwt')
  let mainRoute: any
  let tokenRoute: any
  let ampRoute: any
  let sid = ''

  const userId = FIXTURES.customerId
  const productId = FIXTURES.product1 // for the main-route authed POST/PATCH/GET tests
  const tokenProductId = FIXTURES.product2 // for from-token/amp so product-level unique constraints don't collide
  const sfx = uniqueSuffix()
  const orderId = `00000000-0000-4000-d000-${sfx.slice(0, 12)}`
  const orderItemId = `00000000-0000-4000-e000-${sfx.slice(0, 12)}`

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    jwt = await import('@/lib/auth/jwt')
    const auth = await import('@/lib/auth/auth-sessions')
    mainRoute = await import('@storefront/app/api/(public)/reviews/route')
    tokenRoute = await import('@storefront/app/api/(public)/reviews/from-token/route')
    ampRoute = await import('@storefront/app/api/(public)/reviews/amp/route')
    ;({ sid } = await makeCustomerSession(auth, userId))

    // A delivered order + one order_item for the fixture customer, so the from-token POST's
    // "order delivered" check and the main POST's verified-purchase lookup pass.
    await db.query(
      `INSERT INTO orders (id, order_number, user_id, status, payment_status, subtotal, total_amount, delivered_at)
       VALUES ($1, $2, $3, 'delivered', 'paid', 100, 100, now())
       ON CONFLICT (id) DO NOTHING`,
      [orderId, `APITEST-REV-${sfx.slice(0, 8)}`, userId]
    )
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price)
       VALUES ($1, $2, $3, 'API Test Nut', 1, 25.50, 25.50)
       ON CONFLICT (id) DO NOTHING`,
      [orderItemId, orderId, tokenProductId]
    )

    // Clean any stale reviews for this user so unique per-product checks start fresh.
    await db.query('DELETE FROM product_reviews WHERE user_id = $1', [userId])
  })

  afterAll(async () => {
    await db.query('DELETE FROM product_reviews WHERE user_id = $1', [userId]).catch(() => {})
    await db.query('DELETE FROM order_items WHERE id = $1', [orderItemId]).catch(() => {})
    await db.query('DELETE FROM orders WHERE id = $1', [orderId]).catch(() => {})
    await endPool()
  })

  // ---- (public)/reviews GET (public product listing) ----

  it('GET ?productId returns reviews array (public, no auth)', async () => {
    const req = await apiRequest('GET', `http://localhost/api/reviews?productId=${productId}`)
    const res = await mainRoute.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.reviews)).toBe(true)
  })

  it('GET with no productId and no orderId returns 400', async () => {
    const req = await apiRequest('GET', 'http://localhost/api/reviews')
    const res = await mainRoute.GET(req)
    expect(res.status).toBe(400)
  })

  it('GET ?orderId without a session returns 401', async () => {
    const req = await apiRequest('GET', `http://localhost/api/reviews?orderId=${orderId}`)
    const res = await mainRoute.GET(req)
    expect(res.status).toBe(401)
  })

  // ---- (public)/reviews POST (authed, formData, verified-purchase side-effect) ----

  it('POST creates a review row flagged verified (customer owns a delivered order_item)', async () => {
    const req = await formRequest(
      'POST',
      'http://localhost/api/reviews',
      { productId: tokenProductId, rating: '5', comment: 'Works great only, overall good product' },
      sid
    )
    const res = await mainRoute.POST(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.review).toBeTruthy()
    // Real side-effect: row exists, verified because of the delivered order_item on product2.
    const row = await db.queryOne<{ rating: number; is_verified_purchase: boolean; is_approved: boolean }>(
      'SELECT rating, is_verified_purchase, is_approved FROM product_reviews WHERE user_id = $1 AND product_id = $2',
      [userId, tokenProductId]
    )
    expect(row).toBeTruthy()
    expect(row!.rating).toBe(5)
    expect(row!.is_verified_purchase).toBe(true)
    expect(row!.is_approved).toBe(false) // always starts unapproved
  })

  it('POST a second review for the same product returns 400 (already reviewed)', async () => {
    const req = await formRequest(
      'POST',
      'http://localhost/api/reviews',
      { productId: tokenProductId, rating: '4', comment: 'trying again' },
      sid
    )
    const res = await mainRoute.POST(req)
    expect(res.status).toBe(400)
    const n = await db.queryCount(
      'SELECT count(*) FROM product_reviews WHERE user_id = $1 AND product_id = $2',
      [userId, tokenProductId]
    )
    expect(n).toBe(1)
  })

  it('POST without a session returns 401', async () => {
    const req = await formRequest(
      'POST',
      'http://localhost/api/reviews',
      { productId, rating: '5', comment: 'no session' }
    )
    const res = await mainRoute.POST(req)
    expect(res.status).toBe(401)
  })

  it('POST with an invalid (non-uuid) productId returns 400', async () => {
    const req = await formRequest(
      'POST',
      'http://localhost/api/reviews',
      { productId: 'not-a-uuid', rating: '5', comment: 'bad id' },
      sid
    )
    const res = await mainRoute.POST(req)
    expect(res.status).toBe(400)
  })

  it('POST with rating out of range returns 400', async () => {
    const req = await formRequest(
      'POST',
      'http://localhost/api/reviews',
      { productId, rating: '9', comment: 'too high' },
      sid
    )
    const res = await mainRoute.POST(req)
    expect(res.status).toBe(400)
  })

  // product1 has no delivered order_item for this user → unverified review.
  it('POST on an un-purchased product creates an unverified review', async () => {
    const req = await formRequest(
      'POST',
      'http://localhost/api/reviews',
      { productId, rating: '3', comment: 'ok na, not bought here' },
      sid
    )
    const res = await mainRoute.POST(req)
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ is_verified_purchase: boolean }>(
      'SELECT is_verified_purchase FROM product_reviews WHERE user_id = $1 AND product_id = $2',
      [userId, productId]
    )
    expect(row!.is_verified_purchase).toBe(false)
  })

  // ---- (public)/reviews GET ?orderId (authed, joins order_items) ----

  it('GET ?orderId returns the customer\'s reviews for products in that order', async () => {
    const req = await apiRequest('GET', `http://localhost/api/reviews?orderId=${orderId}`, { sid })
    const res = await mainRoute.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.reviews)).toBe(true)
    // The product2 review was for a product in this order → it should appear.
    expect(body.reviews.some((r: any) => r.product_id === tokenProductId)).toBe(true)
  })

  // ---- (public)/reviews PATCH (authed, formData, update + re-approval reset) ----

  it('PATCH updates the owner\'s review and resets is_approved', async () => {
    const existing = await db.queryOne<{ id: string }>(
      'SELECT id FROM product_reviews WHERE user_id = $1 AND product_id = $2',
      [userId, productId]
    )
    // Pre-approve it so we can prove PATCH flips it back to false.
    await db.query('UPDATE product_reviews SET is_approved = true WHERE id = $1', [existing!.id])

    const req = await formRequest(
      'PATCH',
      'http://localhost/api/reviews',
      { reviewId: existing!.id, rating: '4', comment: 'updated review text', title: 'Edited' },
      sid
    )
    const res = await mainRoute.PATCH(req)
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ rating: number; comment: string; title: string; is_approved: boolean }>(
      'SELECT rating, comment, title, is_approved FROM product_reviews WHERE id = $1',
      [existing!.id]
    )
    expect(row!.rating).toBe(4)
    expect(row!.comment).toBe('updated review text')
    expect(row!.title).toBe('Edited')
    expect(row!.is_approved).toBe(false)
  })

  it('PATCH without reviewId/rating/comment returns 400', async () => {
    const req = await formRequest('PATCH', 'http://localhost/api/reviews', { reviewId: '' }, sid)
    const res = await mainRoute.PATCH(req)
    expect(res.status).toBe(400)
  })

  it('PATCH on a review not owned by the caller returns 404', async () => {
    const req = await formRequest(
      'PATCH',
      'http://localhost/api/reviews',
      { reviewId: '00000000-0000-4000-f000-0000000000ff', rating: '5', comment: 'not mine' },
      sid
    )
    const res = await mainRoute.PATCH(req)
    expect(res.status).toBe(404)
  })

  it('PATCH without a session returns 401', async () => {
    const req = await formRequest(
      'PATCH',
      'http://localhost/api/reviews',
      { reviewId: '00000000-0000-4000-f000-0000000000ff', rating: '5', comment: 'x' }
    )
    const res = await mainRoute.PATCH(req)
    expect(res.status).toBe(401)
  })

  // ---- (public)/reviews/from-token GET ----

  it('from-token GET with no token returns 400', async () => {
    const req = await apiRequest('GET', 'http://localhost/api/reviews/from-token')
    const res = await tokenRoute.GET(req)
    expect(res.status).toBe(400)
  })

  it('from-token GET with a bad token returns 401', async () => {
    const req = await apiRequest('GET', 'http://localhost/api/reviews/from-token?token=garbage')
    const res = await tokenRoute.GET(req)
    expect(res.status).toBe(401)
  })

  it('from-token GET with a valid token returns product info + alreadyReviewed', async () => {
    const token = await jwt.generateReviewToken({ orderId, productId: tokenProductId, userId })
    const req = await apiRequest('GET', `http://localhost/api/reviews/from-token?token=${token}`)
    const res = await tokenRoute.GET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.productId).toBe(tokenProductId)
    expect(body.productName).toBe('API Test Nut')
    // tokenProductId already has a review from the POST block above.
    expect(body.alreadyReviewed).toBe(true)
  })

  // ---- (public)/reviews/from-token POST ----

  it('from-token POST with missing fields returns 400', async () => {
    const req = await apiRequest('POST', 'http://localhost/api/reviews/from-token', { body: { token: 'x' } })
    const res = await tokenRoute.POST(req)
    expect(res.status).toBe(400)
  })

  it('from-token POST with a bad token returns 401', async () => {
    const req = await apiRequest('POST', 'http://localhost/api/reviews/from-token', {
      body: { token: 'garbage', rating: 5, comment: 'nice' },
    })
    const res = await tokenRoute.POST(req)
    expect(res.status).toBe(401)
  })

  it('from-token POST inserts a verified review for an un-reviewed product in a delivered order', async () => {
    // Fresh product with a delivered order_item but no existing review for this user.
    const freshProduct = `00000000-0000-4000-b000-${uniqueSuffix().slice(0, 12)}`
    await db.query(
      `INSERT INTO products (id, sku, name, slug, base_price) VALUES ($1, $2, $3, $4, 10.00)`,
      [freshProduct, `APITEST-FT-${sfx.slice(0, 6)}`, 'FromToken Product', `fromtoken-${sfx.slice(0, 6)}`]
    )
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price)
       VALUES (gen_random_uuid(), $1, $2, 'FromToken Product', 1, 10, 10)`,
      [orderId, freshProduct]
    )
    try {
      const token = await jwt.generateReviewToken({ orderId, productId: freshProduct, userId })
      const req = await apiRequest('POST', 'http://localhost/api/reviews/from-token', {
        body: { token, rating: 5, comment: 'from the token flow', title: 'Great', tags: ['quality', 'value'] },
      })
      const res = await tokenRoute.POST(req)
      expect(res.status).toBe(200)
      const row = await db.queryOne<{ is_verified_purchase: boolean; order_id: string; tags: any }>(
        'SELECT is_verified_purchase, order_id, tags FROM product_reviews WHERE user_id = $1 AND product_id = $2',
        [userId, freshProduct]
      )
      expect(row).toBeTruthy()
      expect(row!.is_verified_purchase).toBe(true) // token route hardcodes verified = true
      expect(row!.order_id).toBe(orderId)
      expect(row!.tags).toEqual(['quality', 'value'])
    } finally {
      await db.query('DELETE FROM product_reviews WHERE user_id = $1 AND product_id = $2', [userId, freshProduct]).catch(() => {})
      await db.query('DELETE FROM order_items WHERE product_id = $1', [freshProduct]).catch(() => {})
      await db.query('DELETE FROM products WHERE id = $1', [freshProduct]).catch(() => {})
    }
  })

  it('from-token POST a duplicate (already reviewed) returns 400', async () => {
    const token = await jwt.generateReviewToken({ orderId, productId: tokenProductId, userId })
    const req = await apiRequest('POST', 'http://localhost/api/reviews/from-token', {
      body: { token, rating: 4, comment: 'again' },
    })
    const res = await tokenRoute.POST(req)
    expect(res.status).toBe(400)
  })

  // ---- (public)/reviews/amp POST ----

  it('amp POST with no token returns 400', async () => {
    const req = await apiRequest('POST', 'http://localhost/api/reviews/amp', { body: { rating: 5, comment: 'x' } })
    const res = await ampRoute.POST(req)
    expect(res.status).toBe(400)
  })

  it('amp POST with a bad token returns 401', async () => {
    const req = await apiRequest('POST', 'http://localhost/api/reviews/amp', {
      body: { token: 'garbage', rating: 5, comment: 'x' },
    })
    const res = await ampRoute.POST(req)
    expect(res.status).toBe(401)
  })

  it('amp POST inserts a review for an un-reviewed delivered product (json body)', async () => {
    const freshProduct = `00000000-0000-4000-b000-${uniqueSuffix().slice(0, 12)}`
    await db.query(
      `INSERT INTO products (id, sku, name, slug, base_price) VALUES ($1, $2, $3, $4, 10.00)`,
      [freshProduct, `APITEST-AMP-${sfx.slice(0, 6)}`, 'Amp Product', `amp-${sfx.slice(0, 6)}`]
    )
    await db.query(
      `INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, total_price)
       VALUES (gen_random_uuid(), $1, $2, 'Amp Product', 1, 10, 10)`,
      [orderId, freshProduct]
    )
    try {
      const token = await jwt.generateReviewToken({ orderId, productId: freshProduct, userId })
      const req = await apiRequest('POST', 'http://localhost/api/reviews/amp', {
        body: { token, rating: 4, comment: 'amp submitted review' },
      })
      const res = await ampRoute.POST(req)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      const row = await db.queryOne<{ rating: number; is_verified_purchase: boolean; is_approved: boolean }>(
        'SELECT rating, is_verified_purchase, is_approved FROM product_reviews WHERE user_id = $1 AND product_id = $2',
        [userId, freshProduct]
      )
      expect(row).toBeTruthy()
      expect(row!.rating).toBe(4)
      expect(row!.is_verified_purchase).toBe(true)
      expect(row!.is_approved).toBe(false)
    } finally {
      await db.query('DELETE FROM product_reviews WHERE user_id = $1 AND product_id = $2', [userId, freshProduct]).catch(() => {})
      await db.query('DELETE FROM order_items WHERE product_id = $1', [freshProduct]).catch(() => {})
      await db.query('DELETE FROM products WHERE id = $1', [freshProduct]).catch(() => {})
    }
  })

  it('amp POST a duplicate (already reviewed) returns 409', async () => {
    const token = await jwt.generateReviewToken({ orderId, productId: tokenProductId, userId })
    const req = await apiRequest('POST', 'http://localhost/api/reviews/amp', {
      body: { token, rating: 5, comment: 'amp dup' },
    })
    const res = await ampRoute.POST(req)
    expect(res.status).toBe(409)
  })
})
