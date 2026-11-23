// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — update a category (PATCH [id]).
// Gated on categories:write. To keep this pure-DB (no AI gateway), the update case uses an admin WITHOUT
// catalog_enrichment:write (canUseAi=false) and passes a valid icon_name + a valid numeric google category,
// so suggestIcon() and the taxonomy AI match are both skipped.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// revalidatePath needs a Next request context that does not exist in a unit runner; stub the cache calls.
vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))

describe.skipIf(!API_DB_ENABLED)('admin category update API (real DB)', () => {
  let PATCH: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let writeSid = ''
  let narrowSid = ''
  const catId = '00000000-0000-4000-c4a0-' + uniqueSuffix().padEnd(12, '0').slice(0, 12)
  const ctx = { params: Promise.resolve({ id: catId }) }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/categories/[id]/route')
    PATCH = route.PATCH as any
    // categories:write WITHOUT catalog_enrichment:write and a non-platform role → passes the scope gate,
    // but canUseAi() is false so no AI calls fire.
    ;({ sid: writeSid } = await makeAdminSession(auth, FIXTURES.adminId, ['categories:write'], 'manager'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['categories:read'], 'manager'))
    await db.query(
      `INSERT INTO categories (id, name, slug, is_draft, is_active) VALUES ($1, $2, $3, true, true) ON CONFLICT (id) DO NOTHING`,
      [catId, 'Update Test Cat ' + catId.slice(-6), 'update-test-cat-' + catId.slice(-6)]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM draft_locks WHERE resource_type='category' AND resource_id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM entity_revisions WHERE resource_type='category' AND resource_id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM categories WHERE id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('401 without a session', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/categories/${catId}`, { body: { name: 'x' } }) as any, ctx)
    expect(res.status).toBe(401)
  })

  it('403 for an admin lacking categories:write', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/categories/${catId}`, { sid: narrowSid, body: { name: 'x' } }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('400 when name is blank (full-update branch)', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/categories/${catId}`, { sid: writeSid, body: { name: '   ' } }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('200 publishes a create-draft (is_draft=false, no name) — pure DB branch', async () => {
    const res = await PATCH(await apiRequest('PATCH', `http://localhost/api/admin/categories/${catId}`, { sid: writeSid, body: { is_draft: false, is_active: true } }) as any, ctx)
    expect(res.status).toBe(200)
    const { rows } = await db.query(`SELECT is_draft, is_active FROM categories WHERE id = $1`, [catId])
    expect(rows[0].is_draft).toBe(false)
    expect(rows[0].is_active).toBe(true)
  })

  it('200 full update writes name/slug/display_order/icon/google category and records a revision', async () => {
    const res = await PATCH(
      await apiRequest('PATCH', `http://localhost/api/admin/categories/${catId}`, {
        sid: writeSid,
        body: {
          name: 'Fasteners & Fixings',
          description: 'Bolts and nuts',
          display_order: 5,
          sku_prefix: 'fx-9',
          is_active: true,
          icon_name: 'Bolt', // provided → suggestIcon() skipped
          google_product_category: '1', // valid numeric id → taxonomy resolves without AI
        },
      }) as any,
      ctx
    )
    expect(res.status).toBe(200)
    const updated = await res.json()
    expect(updated.name).toBe('Fasteners & Fixings')

    const { rows } = await db.query(
      `SELECT name, slug, display_order, sku_prefix, icon_name, google_product_category FROM categories WHERE id = $1`,
      [catId]
    )
    expect(rows[0].slug).toBe('fasteners-fixings')
    expect(rows[0].display_order).toBe(5)
    expect(rows[0].sku_prefix).toBe('FX9') // uppercased, non-alnum stripped
    expect(rows[0].icon_name).toBe('Bolt')
    expect(rows[0].google_product_category).toBe('Animals & Pet Supplies')

    // Side-effect: a direct revision row is recorded for the category.
    const rev = await db.query(`SELECT count(*)::int AS n FROM entity_revisions WHERE resource_type='category' AND resource_id = $1`, [catId])
    expect(rev.rows[0].n).toBeGreaterThan(0)
  })
})
