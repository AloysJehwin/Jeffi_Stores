// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — publish a category draft (POST [id]/publish).
// Gated on categories:write. Merges a real draft into the live category row.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin category publish API (real DB)', () => {
  let POST: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  const catId = '00000000-0000-4000-c3a0-' + uniqueSuffix().padEnd(12, '0').slice(0, 12)
  const ctx = { params: Promise.resolve({ id: catId }) }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/categories/[id]/publish/route')
    POST = route.POST as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['categories:read'], 'manager'))
    await db.query(
      `INSERT INTO categories (id, name, slug, display_order) VALUES ($1, $2, $3, 0) ON CONFLICT (id) DO NOTHING`,
      [catId, 'Publish Test Cat ' + catId.slice(-6), 'publish-test-cat-' + catId.slice(-6)]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM draft_locks WHERE resource_type='category' AND resource_id IN (SELECT id FROM category_drafts WHERE category_id=$1)`, [catId]).catch(() => {})
    await db.query(`DELETE FROM draft_locks WHERE resource_type='category' AND resource_id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM category_drafts WHERE category_id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM entity_revisions WHERE resource_type='category' AND resource_id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM categories WHERE id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('401 without a session', async () => {
    const res = await POST(await apiRequest('POST', `http://localhost/api/admin/categories/${catId}/publish`, { body: {} }) as any, ctx)
    expect(res.status).toBe(401)
  })

  it('403 for an admin lacking categories:write', async () => {
    const res = await POST(await apiRequest('POST', `http://localhost/api/admin/categories/${catId}/publish`, { sid: narrowSid, body: {} }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('400 when no draft id is supplied', async () => {
    const res = await POST(await apiRequest('POST', `http://localhost/api/admin/categories/${catId}/publish`, { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('404 when the draft is not on this category', async () => {
    const res = await POST(await apiRequest('POST', `http://localhost/api/admin/categories/${catId}/publish?draft=00000000-0000-4000-c3ff-ffffffffffff`, { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(404)
  })

  it('200 merges a real draft into the live category', async () => {
    // Create the draft via the real adapter (base = live snapshot → no false conflict), then set only
    // the fields this draft changes, and publish it.
    const branches = await import('@/lib/admin/draft-branches')
    const { categoryDrafts } = await import('@/lib/catalog/category-draft')
    const draftId = await branches.createDraft(categoryDrafts, { adminId: FIXTURES.adminId }, catId, { title: 'Publish me' })
    await db.query(`UPDATE category_drafts SET fields = $2::jsonb WHERE id = $1`, [
      draftId,
      JSON.stringify({ name: 'Published Name', display_order: 7 }),
    ])
    const res = await POST(await apiRequest('POST', `http://localhost/api/admin/categories/${catId}/publish?draft=${draftId}`, { sid: fullSid, body: {} }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.categoryId).toBe(catId)

    // Real DB: the live category reflects the draft, and the draft row is gone.
    const { rows } = await db.query(`SELECT name, display_order FROM categories WHERE id = $1`, [catId])
    expect(rows[0].name).toBe('Published Name')
    expect(rows[0].display_order).toBe(7)
    const gone = await db.query(`SELECT count(*)::int AS n FROM category_drafts WHERE id = $1`, [draftId])
    expect(gone.rows[0].n).toBe(0)
  })
})
