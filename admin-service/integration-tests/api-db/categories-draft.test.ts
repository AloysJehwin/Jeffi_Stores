// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — category drafts (GET/POST/PATCH/DELETE on [id]/draft).
// All four methods gated on categories:write. Real draft rows in category_drafts + draft_locks.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin category drafts API (real DB)', () => {
  let GET: (req: any, ctx: any) => Promise<Response>
  let POST: (req: any, ctx: any) => Promise<Response>
  let PATCH: (req: any, ctx: any) => Promise<Response>
  let DELETE: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  const catId = '00000000-0000-4000-c2a0-' + uniqueSuffix().padEnd(12, '0').slice(0, 12)
  const ctx = { params: Promise.resolve({ id: catId }) }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/categories/[id]/draft/route')
    GET = route.GET as any
    POST = route.POST as any
    PATCH = route.PATCH as any
    DELETE = route.DELETE as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['categories:read'], 'manager'))
    await db.query(
      `INSERT INTO categories (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [catId, 'Draft Test Cat ' + catId.slice(-6), 'draft-test-cat-' + catId.slice(-6)]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM draft_locks WHERE resource_type='category' AND resource_id IN (SELECT id FROM category_drafts WHERE category_id=$1)`, [catId]).catch(() => {})
    await db.query(`DELETE FROM category_drafts WHERE category_id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM categories WHERE id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('GET 401 without a session', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/admin/categories/${catId}/draft`) as any, ctx)
    expect(res.status).toBe(401)
  })

  it('GET 403 for an admin lacking categories:write', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/admin/categories/${catId}/draft`, { sid: narrowSid }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('GET 200 returns an (initially empty) drafts list', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/admin/categories/${catId}/draft`, { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.drafts)).toBe(true)
    expect(body.drafts.length).toBe(0)
  })

  it('POST 403 for an admin lacking categories:write', async () => {
    const res = await POST(await apiRequest('POST', `http://localhost/api/admin/categories/${catId}/draft`, { sid: narrowSid, body: {} }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('POST 404 when the category does not exist', async () => {
    const missing = '00000000-0000-4000-c2ff-ffffffffffff'
    const res = await POST(
      await apiRequest('POST', `http://localhost/api/admin/categories/${missing}/draft`, { sid: fullSid, body: {} }) as any,
      { params: Promise.resolve({ id: missing }) }
    )
    expect(res.status).toBe(404)
  })

  let draftId = ''
  it('POST 200 creates a draft row for this admin', async () => {
    const res = await POST(await apiRequest('POST', `http://localhost/api/admin/categories/${catId}/draft`, { sid: fullSid, body: { title: 'My draft' } }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.categoryId).toBe(catId)
    expect(typeof body.draftId).toBe('string')
    draftId = body.draftId

    const { rows } = await db.query(`SELECT category_id, author_admin_id FROM category_drafts WHERE id = $1`, [draftId])
    expect(rows.length).toBe(1)
    expect(rows[0].category_id).toBe(catId)
    expect(rows[0].author_admin_id).toBe(FIXTURES.adminId)
  })

  it('POST again (no new flag) returns the existing draft', async () => {
    const res = await POST(await apiRequest('POST', `http://localhost/api/admin/categories/${catId}/draft`, { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.existing).toBe(true)
    expect(body.draftId).toBe(draftId)
  })

  it('PATCH 400 when draftId or fields missing', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/categories/${catId}/draft`, { sid: fullSid, body: { draftId } }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('PATCH 404 when the draft is not on this category', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/categories/${catId}/draft`, { sid: fullSid, body: { draftId: '00000000-0000-4000-c2ee-eeeeeeeeeeee', fields: { name: 'x' } } }) as any, ctx)
    expect(res.status).toBe(404)
  })

  it('PATCH 200 autosaves fields into the draft', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/categories/${catId}/draft`, { sid: fullSid, body: { draftId, fields: { name: 'Renamed in draft', display_order: 3 }, title: 'Updated title' } }) as any, ctx)
    expect(res.status).toBe(200)
    const { rows } = await db.query(`SELECT fields, title FROM category_drafts WHERE id = $1`, [draftId])
    expect(rows[0].fields.name).toBe('Renamed in draft')
    expect(rows[0].title).toBe('Updated title')
  })

  it('DELETE 400 without the draft param', async () => {
    const res = await DELETE(await apiRequest('DELETE', `http://localhost/api/admin/categories/${catId}/draft`, { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('DELETE 404 when the draft is not on this category', async () => {
    const res = await DELETE(await apiRequest('DELETE', `http://localhost/api/admin/categories/${catId}/draft?draft=00000000-0000-4000-c2dd-dddddddddddd`, { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(404)
  })

  it('DELETE 200 discards the draft (row removed)', async () => {
    const res = await DELETE(await apiRequest('DELETE', `http://localhost/api/admin/categories/${catId}/draft?draft=${draftId}`, { sid: fullSid }) as any, ctx)
    expect(res.status).toBe(200)
    const { rows } = await db.query(`SELECT count(*)::int AS n FROM category_drafts WHERE id = $1`, [draftId])
    expect(rows[0].n).toBe(0)
  })
})
