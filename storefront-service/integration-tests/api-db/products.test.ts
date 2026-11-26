// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — storefront (public) products route group.
// Real Postgres: catalog list/detail/variants/primary-image reads, product_views insert,
// admin-gated PATCH (401/403/400/200 + row), buy-now-quote resolve, affinity validation,
// listing model, ILIKE search. Opt-in via API_DB=1.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeCustomerSession, makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// The /products/search route awaits embed() (AI gateway) for a semantic pass before responding; there is no
// gateway in the test env, so stub rag.embed to throw fast — semanticSearch() swallows it and returns [],
// and the route falls back to its real Postgres ILIKE query (what these tests assert). DB stays real.
// embed()/embedWithModel() throw before runWithHnswTuning is reached; the real module is re-exported.
vi.mock('@/lib/shared/rag', async (orig) => ({
  ...(await orig<typeof import('@/lib/shared/rag')>()),
  embed: vi.fn(async () => {
    throw new Error('embed disabled in api-db tests')
  }),
  embedWithModel: vi.fn(async () => {
    throw new Error('embed disabled in api-db tests')
  }),
}))

describe.skipIf(!API_DB_ENABLED)('products (public) API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let auth: typeof import('@/lib/auth/auth-sessions')

  // Routes
  let listGET: (req: any) => Promise<Response>
  let slugGET: (req: any, ctx: any) => Promise<Response>
  let variantsGET: (req: any, ctx: any) => Promise<Response>
  let primaryImageGET: (req: any, ctx: any) => Promise<Response>
  let viewPOST: (req: any, ctx: any) => Promise<Response>
  let patchPATCH: (req: any, ctx: any) => Promise<Response>
  let buyNowPOST: (req: any, ctx: any) => Promise<Response>
  let affinityGET: (req: any) => Promise<Response>
  let listingGET: (req: any) => Promise<Response>
  let searchGET: (req: any) => Promise<Response>

  // Fixtures + per-file seeded rows
  const p1 = FIXTURES.product1 // active, slug 'api-test-bolt', no variants
  const p2 = FIXTURES.product2
  const customerId = FIXTURES.customerId
  const adminPrincipalId = FIXTURES.adminId
  const suf = uniqueSuffix() // 12 hex chars → fills the final uuid segment
  const extraId = `00000000-0000-4000-b000-${suf}`
  const imageId = `00000000-0000-4000-c000-${suf}`
  const extraSlug = `api-test-extra-${suf}`

  let fullAdminSid = ''
  let narrowAdminSid = ''
  let customerSid = ''

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    auth = await import('@/lib/auth/auth-sessions')

    listGET = (await import('@storefront/app/api/(public)/products/route')).GET as any
    slugGET = (await import('@storefront/app/api/(public)/products/slug/[slug]/route')).GET as any
    variantsGET = (await import('@storefront/app/api/(public)/products/slug/[slug]/variants/route')).GET as any
    primaryImageGET = (await import('@storefront/app/api/(public)/products/[id]/primary-image/route')).GET as any
    viewPOST = (await import('@storefront/app/api/(public)/products/[id]/view/route')).POST as any
    patchPATCH = (await import('@storefront/app/api/(public)/products/[id]/route')).PATCH as any
    buyNowPOST = (await import('@storefront/app/api/(public)/products/[id]/buy-now-quote/route')).POST as any
    affinityGET = (await import('@storefront/app/api/(public)/products/affinity/route')).GET as any
    listingGET = (await import('@storefront/app/api/(public)/products/listing/route')).GET as any
    searchGET = (await import('@storefront/app/api/(public)/products/search/route')).GET as any

    // Sessions
    ;({ sid: customerSid } = await makeCustomerSession(auth, customerId))
    ;({ sid: fullAdminSid } = await makeAdminSession(auth, adminPrincipalId, ['*'], 'administrator'))
    ;({ sid: narrowAdminSid } = await makeAdminSession(auth, adminPrincipalId, ['dashboard:read'], 'manager'))

    // Extra active product (own slug) + one product image, so list/search/image have deterministic rows.
    await db.query(
      `INSERT INTO products (id, sku, name, slug, base_price, inventory_quantity, is_active, is_draft, stock_status)
       VALUES ($1, $2, $3, $4, 42.00, 10, true, false, 'In Stock') ON CONFLICT (id) DO NOTHING`,
      [extraId, `APITEST-EXTRA-${suf}`, `Zylophone Widget ${suf}`, extraSlug]
    )
    await db.query(
      `INSERT INTO product_images (id, product_id, image_url, file_name, is_primary, display_order)
       VALUES ($1, $2, 'https://img.test/primary.jpg', 'primary.jpg', true, 0) ON CONFLICT (id) DO NOTHING`,
      [imageId, extraId]
    )
    // Reset p1 is_active to a known state before PATCH tests mutate it.
    await db.query(`UPDATE products SET is_active = true, is_featured = false WHERE id = $1`, [p1])
    // Clean any stale views for p1 by our fixture customer.
    await db.query(`DELETE FROM product_views WHERE product_id = $1 AND user_id = $2`, [p1, customerId])
  })

  afterAll(async () => {
    await db.query(`DELETE FROM product_views WHERE product_id = ANY($1::uuid[])`, [[p1, p2, extraId]]).catch(() => {})
    await db.query(`DELETE FROM product_images WHERE id = $1`, [imageId]).catch(() => {})
    await db.query(`DELETE FROM products WHERE id = $1`, [extraId]).catch(() => {})
    await db.query(`UPDATE products SET is_active = true, is_featured = false WHERE id = $1`, [p1]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [adminPrincipalId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='customer'`, [customerId]).catch(() => {})
    await endPool()
  })

  // ---- GET /products (list) ----
  it('GET /products returns active products with paging shape', async () => {
    const res = await listGET(await apiRequest('GET', 'http://localhost/api/products?limit=50') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.products)).toBe(true)
    expect(typeof body.total).toBe('number')
    expect(body.page).toBe(1)
    const ids = body.products.map((p: any) => p.id)
    expect(ids).toContain(p1)
    expect(ids).toContain(extraId)
    // Public shape: cost price never leaks.
    for (const p of body.products) expect(p).not.toHaveProperty('cost_price')
  })

  it('GET /products?search= filters to the matching product', async () => {
    const res = await listGET(await apiRequest('GET', `http://localhost/api/products?search=Zylophone%20Widget%20${suf}`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.products.map((p: any) => p.id)
    expect(ids).toContain(extraId)
    expect(ids).not.toContain(p1)
  })

  // ---- GET /products/slug/[slug] ----
  it('GET /products/slug/:slug returns the product for a known slug', async () => {
    const res = await slugGET(await apiRequest('GET', `http://localhost/api/products/slug/${extraSlug}`) as any, {
      params: Promise.resolve({ slug: extraSlug }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.product.id).toBe(extraId)
    expect(body.product).not.toHaveProperty('cost_price')
  })

  it('GET /products/slug/:slug returns 404 for an unknown slug', async () => {
    const res = await slugGET(await apiRequest('GET', 'http://localhost/api/products/slug/does-not-exist-xyz') as any, {
      params: Promise.resolve({ slug: 'does-not-exist-xyz' }),
    })
    expect(res.status).toBe(404)
  })

  // ---- GET /products/slug/[slug]/variants ----
  it('GET /products/slug/:slug/variants returns the variants payload (empty for a simple product)', async () => {
    const res = await variantsGET(await apiRequest('GET', `http://localhost/api/products/slug/${extraSlug}/variants`) as any, {
      params: Promise.resolve({ slug: extraSlug }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.product_variants)).toBe(true)
    expect(body.product_variants.length).toBe(0)
    expect(body.is_digital).toBe(false)
  })

  it('GET /products/slug/:slug/variants returns 404 for an unknown slug', async () => {
    const res = await variantsGET(await apiRequest('GET', 'http://localhost/api/products/slug/nope-xyz/variants') as any, {
      params: Promise.resolve({ slug: 'nope-xyz' }),
    })
    expect(res.status).toBe(404)
  })

  // ---- GET /products/[id]/primary-image ----
  it('GET /products/:id/primary-image returns the seeded primary image + name', async () => {
    const res = await primaryImageGET(await apiRequest('GET', `http://localhost/api/products/${extraId}/primary-image`) as any, {
      params: Promise.resolve({ id: extraId }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imageUrl).toBe('https://img.test/primary.jpg')
    expect(body.productName).toBe(`Zylophone Widget ${suf}`)
  })

  it('GET /products/:id/primary-image returns nulls when there is no image', async () => {
    const res = await primaryImageGET(await apiRequest('GET', `http://localhost/api/products/${p2}/primary-image`) as any, {
      params: Promise.resolve({ id: p2 }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.imageUrl).toBeNull()
    expect(body.productName).toBe('API Test Nut')
  })

  // ---- POST /products/[id]/view ----
  it('POST /products/:id/view inserts a real product_views row for the authed customer', async () => {
    const res = await viewPOST(
      await apiRequest('POST', `http://localhost/api/products/${p1}/view`, { sid: customerSid }) as any,
      { params: Promise.resolve({ id: p1 }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    const n = await db.queryCount(
      'SELECT count(*) FROM product_views WHERE product_id = $1 AND user_id = $2',
      [p1, customerId]
    )
    expect(n).toBeGreaterThanOrEqual(1)
  })

  it('POST /products/:id/view works for a guest (no session) and records a null user_id', async () => {
    const res = await viewPOST(
      await apiRequest('POST', `http://localhost/api/products/${extraId}/view`, { headers: { 'x-session-id': `sess-${suf}` } }) as any,
      { params: Promise.resolve({ id: extraId }) }
    )
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ user_id: string | null }>(
      `SELECT user_id FROM product_views WHERE product_id = $1 AND session_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [extraId, `sess-${suf}`]
    )
    expect(row).toBeTruthy()
    expect(row!.user_id).toBeNull()
  })

  // ---- PATCH /products/[id] (admin-gated) ----
  it('PATCH /products/:id → 401 without a session', async () => {
    const res = await patchPATCH(
      await apiRequest('PATCH', `http://localhost/api/products/${p1}`, { body: { is_active: false } }) as any,
      { params: Promise.resolve({ id: p1 }) }
    )
    expect(res.status).toBe(401)
  })

  it('PATCH /products/:id → 403 for an admin lacking products:write', async () => {
    const res = await patchPATCH(
      await apiRequest('PATCH', `http://localhost/api/products/${p1}`, { sid: narrowAdminSid, body: { is_active: false } }) as any,
      { params: Promise.resolve({ id: p1 }) }
    )
    expect(res.status).toBe(403)
  })

  it('PATCH /products/:id → 400 when no valid fields are supplied', async () => {
    const res = await patchPATCH(
      await apiRequest('PATCH', `http://localhost/api/products/${p1}`, { sid: fullAdminSid, body: { name: 'nope' } }) as any,
      { params: Promise.resolve({ id: p1 }) }
    )
    expect(res.status).toBe(400)
  })

  it('PATCH /products/:id → 200 toggles is_active and persists the row', async () => {
    const res = await patchPATCH(
      await apiRequest('PATCH', `http://localhost/api/products/${p1}`, { sid: fullAdminSid, body: { is_active: false } }) as any,
      { params: Promise.resolve({ id: p1 }) }
    )
    expect(res.status).toBe(200)
    const row = await db.queryOne<{ is_active: boolean }>('SELECT is_active FROM products WHERE id = $1', [p1])
    expect(row!.is_active).toBe(false)
    // restore for other tests
    await db.query(`UPDATE products SET is_active = true WHERE id = $1`, [p1])
  })

  it('PATCH /products/:id → 404 for an admin updating a non-existent product', async () => {
    const res = await patchPATCH(
      await apiRequest('PATCH', `http://localhost/api/products/00000000-0000-4000-b000-0000deadbeef`, {
        sid: fullAdminSid,
        body: { is_active: false },
      }) as any,
      { params: Promise.resolve({ id: '00000000-0000-4000-b000-0000deadbeef' }) }
    )
    expect(res.status).toBe(404)
  })

  // ---- POST /products/[id]/buy-now-quote ----
  it('POST /products/:id/buy-now-quote → 200 for a simple active product', async () => {
    const res = await buyNowPOST(
      await apiRequest('POST', `http://localhost/api/products/${p1}/buy-now-quote`, { body: { qty: 2 } }) as any,
      { params: Promise.resolve({ id: p1 }) }
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.productId).toBe(p1)
    expect(body.qty).toBe(2)
    expect(typeof body.price).toBe('number')
  })

  it('POST /products/:id/buy-now-quote → 400 for an invalid qty', async () => {
    // Route does `Number(body.qty) || 1`, so 0 falls back to 1; a negative qty survives that
    // and is rejected by resolveBuyNowItem (qty <= 0).
    const res = await buyNowPOST(
      await apiRequest('POST', `http://localhost/api/products/${p1}/buy-now-quote`, { body: { qty: -5 } }) as any,
      { params: Promise.resolve({ id: p1 }) }
    )
    expect(res.status).toBe(400)
  })

  it('POST /products/:id/buy-now-quote → 400 for a non-existent product', async () => {
    const missing = '00000000-0000-4000-b000-0000feedface'
    const res = await buyNowPOST(
      await apiRequest('POST', `http://localhost/api/products/${missing}/buy-now-quote`, { body: { qty: 1 } }) as any,
      { params: Promise.resolve({ id: missing }) }
    )
    expect(res.status).toBe(400)
  })

  // ---- GET /products/affinity ----
  it('GET /products/affinity → 400 when ids is missing', async () => {
    const res = await affinityGET(await apiRequest('GET', 'http://localhost/api/products/affinity?kind=bought') as any)
    expect(res.status).toBe(400)
  })

  it('GET /products/affinity → 400 for an invalid kind', async () => {
    const res = await affinityGET(await apiRequest('GET', `http://localhost/api/products/affinity?kind=bogus&ids=${p1}`) as any)
    expect(res.status).toBe(400)
  })

  it('GET /products/affinity → 200 with a products array for a valid query', async () => {
    const res = await affinityGET(await apiRequest('GET', `http://localhost/api/products/affinity?kind=bought&ids=${p1}`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.products)).toBe(true)
  })

  // ---- GET /products/listing ----
  it('GET /products/listing → 200 returns the listing model with products + facets', async () => {
    const res = await listingGET(await apiRequest('GET', 'http://localhost/api/products/listing') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.products)).toBe(true)
    expect(typeof body.total).toBe('number')
  })

  it('GET /products/listing?slim=1 → 200 returns just the product page fields', async () => {
    const res = await listingGET(await apiRequest('GET', 'http://localhost/api/products/listing?slim=1') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.products)).toBe(true)
    expect(body).toHaveProperty('totalPages')
  })

  // ---- GET /products/search (ILIKE path) ----
  it('GET /products/search → returns [] for a query shorter than 2 chars', async () => {
    const res = await searchGET(await apiRequest('GET', 'http://localhost/api/products/search?q=a') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBe(0)
  })

  it('GET /products/search → ILIKE matches the extra product by name', async () => {
    const res = await searchGET(await apiRequest('GET', `http://localhost/api/products/search?q=Zylophone&limit=20`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.map((r: any) => r.id)
    expect(ids).toContain(extraId)
  })
})
