// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — storefront (public) categories route group:
//   GET    /api/categories                (list, ?counts=1, ?slug= detail+faqs, 404)
//   DELETE /api/categories/[id]           (categories:write scope gate; 400 when referenced; 200 real delete)
//   PATCH  /api/categories/reorder        (categories:write scope gate; 400 empty; 200 real update)
// Real sessions + real SQL side-effects asserted against jeffi_test. Opt-in via API_DB=1.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, cleanupRows, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('categories (public) API (real DB)', () => {
  let listGET: (req: any) => Promise<Response>
  let detailDELETE: (req: any, ctx: any) => Promise<Response>
  let reorderPATCH: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''

  const suffix = uniqueSuffix()
  // Seeded category ids for this file (distinct per run).
  const catA = '00000000-0000-4000-c000-0000000000a1'
  const catB = '00000000-0000-4000-c000-0000000000a2' // subcategory of catA
  const catDel = '00000000-0000-4000-c000-0000000000a3' // freely deletable
  const catWithProduct = '00000000-0000-4000-c000-0000000000a4' // blocked by a product ref
  const faqId = '00000000-0000-4000-c000-0000000000f1'
  const slugA = `cat-a-${suffix}`
  const slugDel = `cat-del-${suffix}`
  const slugProd = `cat-prod-${suffix}`
  const inactiveSlug = `cat-inactive-${suffix}`
  const catInactive = '00000000-0000-4000-c000-0000000000a5'

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const listRoute = await import('@storefront/app/api/(public)/categories/route')
    const detailRoute = await import('@storefront/app/api/(public)/categories/[id]/route')
    const reorderRoute = await import('@storefront/app/api/(public)/categories/reorder/route')
    listGET = listRoute.GET as any
    detailDELETE = detailRoute.DELETE as any
    reorderPATCH = reorderRoute.PATCH as any

    // Full platform admin (role 'administrator' → hasScope short-circuits) + a narrow 'manager' without categories:write.
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))

    // Clean any stale rows, then seed. FK-safe order: faqs → children → parents.
    await db.query('DELETE FROM category_faqs WHERE id = $1', [faqId]).catch(() => {})
    await db.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [[catB, catDel, catWithProduct, catInactive, catA]]).catch(() => {})

    await db.query(
      `INSERT INTO categories (id, name, slug, is_active, display_order, description, icon_name, short_name, tagline, show_in_nav, is_featured)
       VALUES ($1,$2,$3,true,10,'Parent desc','box','ShortA','Tag A',true,true)`,
      [catA, `Cat A ${suffix}`, slugA]
    )
    await db.query(
      `INSERT INTO categories (id, name, slug, is_active, display_order, parent_category_id)
       VALUES ($1,$2,$3,true,20,$4)`,
      [catB, `Cat B ${suffix}`, `cat-b-${suffix}`, catA]
    )
    await db.query(
      `INSERT INTO categories (id, name, slug, is_active, display_order)
       VALUES ($1,$2,$3,true,30)`,
      [catDel, `Cat Del ${suffix}`, slugDel]
    )
    await db.query(
      `INSERT INTO categories (id, name, slug, is_active, display_order)
       VALUES ($1,$2,$3,true,40)`,
      [catWithProduct, `Cat Prod ${suffix}`, slugProd]
    )
    await db.query(
      `INSERT INTO categories (id, name, slug, is_active, display_order)
       VALUES ($1,$2,$3,false,50)`,
      [catInactive, `Cat Inactive ${suffix}`, inactiveSlug]
    )
    // One published + one unpublished FAQ on catA.
    await db.query(
      `INSERT INTO category_faqs (id, category_id, question, answer, sort_order, published)
       VALUES ($1,$2,'Q1','A1',0,true)`,
      [faqId, catA]
    )
    await db.query(
      `INSERT INTO category_faqs (category_id, question, answer, sort_order, published)
       VALUES ($1,'Q2-hidden','A2',1,false)`,
      [catA]
    )
    // Point fixture product1 at catWithProduct so a delete of it is refused.
    await db.query('UPDATE products SET category_id = $1 WHERE id = $2', [catWithProduct, FIXTURES.product1])
  })

  afterAll(async () => {
    // Detach product, drop faqs, then children before parents.
    await db.query('UPDATE products SET category_id = NULL WHERE id = $1', [FIXTURES.product1]).catch(() => {})
    await db.query('DELETE FROM category_faqs WHERE category_id = ANY($1::uuid[])', [[catA]]).catch(() => {})
    await cleanupRows(db, [{ table: 'categories', ids: [catB, catDel, catWithProduct, catInactive, catA] }])
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // ---- GET list (public, no auth) ----

  it('GET lists active categories (no inactive) with no auth', async () => {
    const res = await listGET(await apiRequest('GET', 'http://localhost/api/categories') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.categories)).toBe(true)
    const ids = body.categories.map((c: any) => c.id)
    expect(ids).toContain(catA)
    expect(ids).toContain(catDel)
    expect(ids).not.toContain(catInactive) // is_active = false is excluded
    // Lean shape: no description/tagline without ?counts=1
    const a = body.categories.find((c: any) => c.id === catA)
    expect(a).not.toHaveProperty('description')
    expect(a).not.toHaveProperty('tagline')
  })

  it('GET ?counts=1 adds extras and a numeric product_count', async () => {
    const res = await listGET(await apiRequest('GET', 'http://localhost/api/categories?counts=1') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    const prodCat = body.categories.find((c: any) => c.id === catWithProduct)
    expect(prodCat).toBeTruthy()
    expect(prodCat).toHaveProperty('tagline')
    expect(prodCat).toHaveProperty('show_in_nav')
    // product1 is active and linked → own count is exactly 1.
    expect(prodCat.product_count).toBe(1)
    // catDel has no products → 0
    const delCat = body.categories.find((c: any) => c.id === catDel)
    expect(delCat.product_count).toBe(0)
  })

  it('GET ?slug= returns the category profile with only published FAQs', async () => {
    const res = await listGET(await apiRequest('GET', `http://localhost/api/categories?slug=${slugA}`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.category.id).toBe(catA)
    expect(body.category.tagline).toBe('Tag A')
    expect(Array.isArray(body.category.faqs)).toBe(true)
    expect(body.category.faqs).toHaveLength(1) // hidden FAQ excluded
    expect(body.category.faqs[0].question).toBe('Q1')
  })

  it('GET ?slug= of an inactive category is 404', async () => {
    const res = await listGET(await apiRequest('GET', `http://localhost/api/categories?slug=${inactiveSlug}`) as any)
    expect(res.status).toBe(404)
  })

  it('GET ?slug= of an unknown slug is 404', async () => {
    const res = await listGET(await apiRequest('GET', `http://localhost/api/categories?slug=does-not-exist-${suffix}`) as any)
    expect(res.status).toBe(404)
  })

  // ---- DELETE /[id] (admin scope gate) ----

  const delCtx = (id: string) => ({ params: Promise.resolve({ id }) })

  it('DELETE is 401 without a session', async () => {
    const req = await apiRequest('DELETE', `http://localhost/api/categories/${catDel}`)
    const res = await detailDELETE(req as any, delCtx(catDel))
    expect(res.status).toBe(401)
    // No side-effect: row still present.
    const row = await db.queryOne('SELECT id FROM categories WHERE id = $1', [catDel])
    expect(row).toBeTruthy()
  })

  it('DELETE is 403 for an admin lacking categories:write', async () => {
    const req = await apiRequest('DELETE', `http://localhost/api/categories/${catDel}`, { sid: narrowSid })
    const res = await detailDELETE(req as any, delCtx(catDel))
    expect(res.status).toBe(403)
    const row = await db.queryOne('SELECT id FROM categories WHERE id = $1', [catDel])
    expect(row).toBeTruthy()
  })

  it('DELETE is 400 when the category still has products', async () => {
    const req = await apiRequest('DELETE', `http://localhost/api/categories/${catWithProduct}`, { sid: fullSid })
    const res = await detailDELETE(req as any, delCtx(catWithProduct))
    expect(res.status).toBe(400)
    const row = await db.queryOne('SELECT id FROM categories WHERE id = $1', [catWithProduct])
    expect(row).toBeTruthy() // not deleted
  })

  it('DELETE is 400 when the category still has subcategories', async () => {
    const req = await apiRequest('DELETE', `http://localhost/api/categories/${catA}`, { sid: fullSid })
    const res = await detailDELETE(req as any, delCtx(catA))
    expect(res.status).toBe(400)
    const row = await db.queryOne('SELECT id FROM categories WHERE id = $1', [catA])
    expect(row).toBeTruthy()
  })

  it('DELETE removes a referenced-free category (real row gone)', async () => {
    const req = await apiRequest('DELETE', `http://localhost/api/categories/${catDel}`, { sid: fullSid })
    const res = await detailDELETE(req as any, delCtx(catDel))
    expect(res.status).toBe(200)
    const row = await db.queryOne('SELECT id FROM categories WHERE id = $1', [catDel])
    expect(row).toBeNull()
  })

  // ---- PATCH /reorder (admin scope gate) ----

  it('PATCH reorder is 401 without a session', async () => {
    const req = await apiRequest('PATCH', 'http://localhost/api/categories/reorder', {
      body: { updates: [{ id: catB, display_order: 99, parent_category_id: null }] },
    })
    const res = await reorderPATCH(req as any)
    expect(res.status).toBe(401)
  })

  it('PATCH reorder is 403 for an admin lacking categories:write', async () => {
    const req = await apiRequest('PATCH', 'http://localhost/api/categories/reorder', {
      sid: narrowSid,
      body: { updates: [{ id: catB, display_order: 99, parent_category_id: null }] },
    })
    const res = await reorderPATCH(req as any)
    expect(res.status).toBe(403)
  })

  it('PATCH reorder is 400 on an empty updates array', async () => {
    const req = await apiRequest('PATCH', 'http://localhost/api/categories/reorder', { sid: fullSid, body: { updates: [] } })
    const res = await reorderPATCH(req as any)
    expect(res.status).toBe(400)
  })

  it('PATCH reorder updates display_order + parent on the real rows', async () => {
    // Re-parent catB to the top level and bump catWithProduct's order.
    const req = await apiRequest('PATCH', 'http://localhost/api/categories/reorder', {
      sid: fullSid,
      body: {
        updates: [
          { id: catB, display_order: 5, parent_category_id: null },
          { id: catWithProduct, display_order: 7, parent_category_id: catA },
        ],
      },
    })
    const res = await reorderPATCH(req as any)
    expect(res.status).toBe(200)
    const b = await db.queryOne<{ display_order: number; parent_category_id: string | null }>(
      'SELECT display_order, parent_category_id FROM categories WHERE id = $1',
      [catB]
    )
    expect(b!.display_order).toBe(5)
    expect(b!.parent_category_id).toBeNull()
    const p = await db.queryOne<{ display_order: number; parent_category_id: string | null }>(
      'SELECT display_order, parent_category_id FROM categories WHERE id = $1',
      [catWithProduct]
    )
    expect(p!.display_order).toBe(7)
    expect(p!.parent_category_id).toBe(catA)
  })
})
