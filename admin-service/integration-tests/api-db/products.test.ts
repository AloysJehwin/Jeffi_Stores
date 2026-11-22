// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — admin products route group. Exercises the real
// authenticateAdmin → resolveSession → hasScope chain against seeded admin sessions, plus the
// real Postgres reads/writes each route performs. Covers:
//   products/by-sku            GET  (products:read)
//   products/[id]              GET  (products:read), DELETE (isPlatformOwner)
//   products/[id]/offers       GET/PUT (products:read / products:write) — writes product_offer_items
//   products/[id]/suppliers    GET/POST (products:read / products:write) — writes product_suppliers
//   products/draft             POST (products:write) — inserts a products row
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// Narrow admin for 403: non-platform role whose scopes lack the route's required scope.
const NARROW_SCOPES = ['dashboard:read']
const NARROW_ROLE = 'manager'

describe.skipIf(!API_DB_ENABLED)('admin products API (real DB)', () => {
  let db: typeof import('@/lib/shared/db')

  // Route handlers
  let bySku: { GET: (req: any) => Promise<Response> }
  let byId: { GET: (req: any, ctx: any) => Promise<Response>; DELETE: (req: any, ctx: any) => Promise<Response> }
  let offers: { GET: (req: any, ctx: any) => Promise<Response>; PUT: (req: any, ctx: any) => Promise<Response> }
  let suppliers: { GET: (req: any, ctx: any) => Promise<Response>; POST: (req: any, ctx: any) => Promise<Response> }
  let draft: { POST: (req: any) => Promise<Response> }

  let fullSid = ''
  let narrowSid = ''

  // Seeded rows (extra, FK-random ids). FIXTURES.product1/product2 already exist from the seed SQL.
  const productId = FIXTURES.product1
  const offerId = crypto.randomUUID()
  const supplierId = crypto.randomUUID()
  const createdSupplierRowIds: string[] = []
  const createdDraftIds: string[] = []
  const sku = `APITEST-SKU-${crypto.randomBytes(3).toString('hex')}`

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    ;[bySku, byId, offers, suppliers, draft] = (await Promise.all([
      import('@admin/app/api/(admin)/admin/products/by-sku/route'),
      import('@admin/app/api/(admin)/admin/products/[id]/route'),
      import('@admin/app/api/(admin)/admin/products/[id]/offers/route'),
      import('@admin/app/api/(admin)/admin/products/[id]/suppliers/route'),
      import('@admin/app/api/(admin)/admin/products/draft/route'),
    ])) as any

    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, NARROW_SCOPES, NARROW_ROLE))

    // Give FIXTURES.product1 a distinct sku so by-sku resolves it deterministically.
    await db.query('UPDATE products SET sku = $1 WHERE id = $2', [sku, productId])
    // An offer + a supplier to attach.
    await db.query(
      `INSERT INTO product_offers (id, slug, title, display_order, is_active)
       VALUES ($1, $2, $3, 0, true)`,
      [offerId, `apitest-offer-${crypto.randomBytes(3).toString('hex')}`, 'API Test Offer']
    )
    await db.query(`INSERT INTO suppliers (id, name) VALUES ($1, $2)`, [supplierId, 'API Test Supplier'])
  })

  afterAll(async () => {
    await db.query(`DELETE FROM product_offer_items WHERE product_id = $1`, [productId]).catch(() => {})
    await db.query(`DELETE FROM product_offers WHERE id = $1`, [offerId]).catch(() => {})
    await db.query(`DELETE FROM product_suppliers WHERE id = ANY($1::uuid[])`, [createdSupplierRowIds]).catch(() => {})
    await db.query(`DELETE FROM product_suppliers WHERE supplier_id = $1`, [supplierId]).catch(() => {})
    await db.query(`DELETE FROM suppliers WHERE id = $1`, [supplierId]).catch(() => {})
    if (createdDraftIds.length)
      await db.query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [createdDraftIds]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // ---- by-sku (GET, products:read) ----
  describe('GET /products/by-sku', () => {
    const url = (q?: string) => `http://localhost/api/admin/products/by-sku${q != null ? `?q=${encodeURIComponent(q)}` : ''}`

    it('401 without a session', async () => {
      const res = await bySku.GET(await apiRequest('GET', url('x')) as any)
      expect(res.status).toBe(401)
    })

    it('403 for an admin lacking products:read', async () => {
      const res = await bySku.GET(await apiRequest('GET', url('x'), { sid: narrowSid }) as any)
      expect(res.status).toBe(403)
    })

    it('400 when q is missing', async () => {
      const res = await bySku.GET(await apiRequest('GET', url(), { sid: fullSid }) as any)
      expect(res.status).toBe(400)
    })

    it('200 + resolves a real product by sku', async () => {
      const res = await bySku.GET(await apiRequest('GET', url(sku), { sid: fullSid }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.type).toBe('product')
      expect(body.item.id).toBe(productId)
      expect(body.item.sku).toBe(sku)
    })

    it('404 for an unknown sku', async () => {
      const res = await bySku.GET(await apiRequest('GET', url('NO-SUCH-SKU-XYZ'), { sid: fullSid }) as any)
      expect(res.status).toBe(404)
    })
  })

  // ---- [id] (GET products:read, DELETE isPlatformOwner) ----
  describe('GET /products/[id]', () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

    it('401 without a session', async () => {
      const res = await byId.GET(await apiRequest('GET', `http://localhost/api/admin/products/${productId}`) as any, ctx(productId))
      expect(res.status).toBe(401)
    })

    it('403 for an admin lacking products:read', async () => {
      const res = await byId.GET(await apiRequest('GET', `http://localhost/api/admin/products/${productId}`, { sid: narrowSid }) as any, ctx(productId))
      expect(res.status).toBe(403)
    })

    it('404 for an unknown product', async () => {
      const missing = crypto.randomUUID()
      const res = await byId.GET(await apiRequest('GET', `http://localhost/api/admin/products/${missing}`, { sid: fullSid }) as any, ctx(missing))
      expect(res.status).toBe(404)
    })

    it('200 + real product body for the full admin', async () => {
      const res = await byId.GET(await apiRequest('GET', `http://localhost/api/admin/products/${productId}`, { sid: fullSid }) as any, ctx(productId))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBe(productId)
      expect(body).toHaveProperty('media')
      expect(body).toHaveProperty('faqs')
    })
  })

  describe('DELETE /products/[id]', () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

    it('401 without a session', async () => {
      const res = await byId.DELETE(await apiRequest('DELETE', `http://localhost/api/admin/products/${productId}`) as any, ctx(productId))
      expect(res.status).toBe(401)
    })

    it('403 for a non platform-owner admin (DELETE needs isPlatformOwner)', async () => {
      const res = await byId.DELETE(await apiRequest('DELETE', `http://localhost/api/admin/products/${productId}`, { sid: narrowSid }) as any, ctx(productId))
      expect(res.status).toBe(403)
      // Row must survive the rejected delete.
      const still = await db.query('SELECT 1 FROM products WHERE id = $1', [productId])
      expect(still.rowCount).toBe(1)
    })
  })

  // ---- [id]/offers (GET products:read, PUT products:write) ----
  describe('/products/[id]/offers', () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
    const url = (id: string) => `http://localhost/api/admin/products/${id}/offers`

    it('GET 401 without a session', async () => {
      const res = await offers.GET(await apiRequest('GET', url(productId)) as any, ctx(productId))
      expect(res.status).toBe(401)
    })

    it('GET 403 for an admin lacking products:read', async () => {
      const res = await offers.GET(await apiRequest('GET', url(productId), { sid: narrowSid }) as any, ctx(productId))
      expect(res.status).toBe(403)
    })

    it('GET 404 for an unknown product', async () => {
      const missing = crypto.randomUUID()
      const res = await offers.GET(await apiRequest('GET', url(missing), { sid: fullSid }) as any, ctx(missing))
      expect(res.status).toBe(404)
    })

    it('PUT 403 for an admin lacking products:write', async () => {
      const res = await offers.PUT(await apiRequest('PUT', url(productId), { sid: narrowSid, body: { offerIds: [offerId] } }) as any, ctx(productId))
      expect(res.status).toBe(403)
    })

    it('PUT 400 on an invalid payload (offerIds not uuids)', async () => {
      const res = await offers.PUT(await apiRequest('PUT', url(productId), { sid: fullSid, body: { offerIds: ['not-a-uuid'] } }) as any, ctx(productId))
      expect(res.status).toBe(400)
    })

    it('PUT writes product_offer_items, then GET reads them back', async () => {
      const put = await offers.PUT(await apiRequest('PUT', url(productId), { sid: fullSid, body: { offerIds: [offerId] } }) as any, ctx(productId))
      expect(put.status).toBe(200)
      expect((await put.json()).count).toBe(1)

      // Real side-effect in the DB.
      const link = await db.query('SELECT 1 FROM product_offer_items WHERE product_id = $1 AND offer_id = $2', [productId, offerId])
      expect(link.rowCount).toBe(1)

      const get = await offers.GET(await apiRequest('GET', url(productId), { sid: fullSid }) as any, ctx(productId))
      expect(get.status).toBe(200)
      const body = await get.json()
      expect(body.offers.map((o: any) => o.id)).toContain(offerId)
    })

    it('PUT with [] clears the offers (verified in DB)', async () => {
      const put = await offers.PUT(await apiRequest('PUT', url(productId), { sid: fullSid, body: { offerIds: [] } }) as any, ctx(productId))
      expect(put.status).toBe(200)
      const link = await db.query('SELECT 1 FROM product_offer_items WHERE product_id = $1', [productId])
      expect(link.rowCount).toBe(0)
    })
  })

  // ---- [id]/suppliers (GET products:read, POST products:write) ----
  describe('/products/[id]/suppliers', () => {
    const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
    const url = (id: string) => `http://localhost/api/admin/products/${id}/suppliers`

    it('GET 401 without a session', async () => {
      const res = await suppliers.GET(await apiRequest('GET', url(productId)) as any, ctx(productId))
      expect(res.status).toBe(401)
    })

    it('GET 403 for an admin lacking products:read', async () => {
      const res = await suppliers.GET(await apiRequest('GET', url(productId), { sid: narrowSid }) as any, ctx(productId))
      expect(res.status).toBe(403)
    })

    it('GET 404 for an unknown product', async () => {
      const missing = crypto.randomUUID()
      const res = await suppliers.GET(await apiRequest('GET', url(missing), { sid: fullSid }) as any, ctx(missing))
      expect(res.status).toBe(404)
    })

    it('POST 403 for an admin lacking products:write', async () => {
      const res = await suppliers.POST(await apiRequest('POST', url(productId), { sid: narrowSid, body: { supplier_id: supplierId, unit_cost: 10 } }) as any, ctx(productId))
      expect(res.status).toBe(403)
    })

    it('POST 400 when supplier_id is missing', async () => {
      const res = await suppliers.POST(await apiRequest('POST', url(productId), { sid: fullSid, body: { unit_cost: 10 } }) as any, ctx(productId))
      expect(res.status).toBe(400)
    })

    it('POST 400 when unit_cost is negative', async () => {
      const res = await suppliers.POST(await apiRequest('POST', url(productId), { sid: fullSid, body: { supplier_id: supplierId, unit_cost: -1 } }) as any, ctx(productId))
      expect(res.status).toBe(400)
    })

    it('POST 400 when both variant_id and sub_variant_id are set', async () => {
      const res = await suppliers.POST(
        await apiRequest('POST', url(productId), {
          sid: fullSid,
          body: { supplier_id: supplierId, unit_cost: 5, variant_id: crypto.randomUUID(), sub_variant_id: crypto.randomUUID() },
        }) as any,
        ctx(productId)
      )
      expect(res.status).toBe(400)
    })

    it('POST 404 for an unknown product', async () => {
      const missing = crypto.randomUUID()
      const res = await suppliers.POST(await apiRequest('POST', url(missing), { sid: fullSid, body: { supplier_id: supplierId, unit_cost: 5 } }) as any, ctx(missing))
      expect(res.status).toBe(404)
    })

    it('POST inserts a product_suppliers row, then GET reads it back', async () => {
      const post = await suppliers.POST(
        await apiRequest('POST', url(productId), { sid: fullSid, body: { supplier_id: supplierId, unit_cost: 42.5, is_preferred: true } }) as any,
        ctx(productId)
      )
      expect(post.status).toBe(200)
      const { id: rowId } = await post.json()
      expect(rowId).toBeTruthy()
      createdSupplierRowIds.push(rowId)

      // Real side-effect.
      const row = await db.query('SELECT unit_cost, is_preferred FROM product_suppliers WHERE id = $1', [rowId])
      expect(row.rowCount).toBe(1)
      expect(Number(row.rows[0].unit_cost)).toBe(42.5)
      expect(row.rows[0].is_preferred).toBe(true)

      const get = await suppliers.GET(await apiRequest('GET', url(productId), { sid: fullSid }) as any, ctx(productId))
      expect(get.status).toBe(200)
      const body = await get.json()
      expect(body.suppliers.some((s: any) => s.id === rowId)).toBe(true)
    })
  })

  // ---- draft (POST products:write) ----
  describe('POST /products/draft', () => {
    const url = 'http://localhost/api/admin/products/draft'

    it('401 without a session', async () => {
      const res = await draft.POST(await apiRequest('POST', url, { body: { name: 'X' } }) as any)
      expect(res.status).toBe(401)
    })

    it('403 for an admin lacking products:write', async () => {
      const res = await draft.POST(await apiRequest('POST', url, { sid: narrowSid, body: { name: 'X' } }) as any)
      expect(res.status).toBe(403)
    })

    it('400 when name is missing', async () => {
      const res = await draft.POST(await apiRequest('POST', url, { sid: fullSid, body: {} }) as any)
      expect(res.status).toBe(400)
    })

    it('inserts a real draft products row', async () => {
      const name = `API Test Draft ${crypto.randomBytes(3).toString('hex')}`
      const res = await draft.POST(await apiRequest('POST', url, { sid: fullSid, body: { name } }) as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.id).toBeTruthy()
      createdDraftIds.push(body.id)

      const row = await db.query('SELECT name, is_draft, is_active FROM products WHERE id = $1', [body.id])
      expect(row.rowCount).toBe(1)
      expect(row.rows[0].name).toBe(name)
      expect(row.rows[0].is_draft).toBe(true)
      expect(row.rows[0].is_active).toBe(false)
    })
  })
})
