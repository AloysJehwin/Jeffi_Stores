// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — admin category FAQs (GET/PUT).
// Real authenticateAdmin→resolveSession→hasScope chain + real category_faqs read/write.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin category FAQs API (real DB)', () => {
  let GET: (req: any, ctx: any) => Promise<Response>
  let PUT: (req: any, ctx: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let readOnlySid = ''
  let narrowSid = ''
  const catId = '00000000-0000-4000-c1a0-' + uniqueSuffix().padEnd(12, '0').slice(0, 12)
  const ctx = { params: Promise.resolve({ id: catId }) }

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/categories/[id]/faqs/route')
    GET = route.GET as any
    PUT = route.PUT as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: readOnlySid } = await makeAdminSession(auth, FIXTURES.adminId, ['categories:read'], 'manager'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    await db.query(
      `INSERT INTO categories (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [catId, 'FAQ Test Cat ' + catId.slice(-6), 'faq-test-cat-' + catId.slice(-6)]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM category_faqs WHERE category_id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM categories WHERE id = $1`, [catId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // GET scope: categories:read
  it('GET 401 without a session', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/admin/categories/${catId}/faqs`) as any, ctx)
    expect(res.status).toBe(401)
  })

  it('GET 403 for an admin lacking categories:read', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/admin/categories/${catId}/faqs`, { sid: narrowSid }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('GET 200 returns the (initially empty) faqs list', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/admin/categories/${catId}/faqs`, { sid: readOnlySid }) as any, ctx)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.faqs)).toBe(true)
    expect(body.faqs.length).toBe(0)
  })

  // PUT scope: categories:write
  it('PUT 401 without a session', async () => {
    const res = await PUT(await apiRequest('PUT', `http://localhost/api/admin/categories/${catId}/faqs`, { body: { faqs: [] } }) as any, ctx)
    expect(res.status).toBe(401)
  })

  it('PUT 403 for a read-only admin', async () => {
    const res = await PUT(await apiRequest('PUT', `http://localhost/api/admin/categories/${catId}/faqs`, { sid: readOnlySid, body: { faqs: [] } }) as any, ctx)
    expect(res.status).toBe(403)
  })

  it('PUT 400 when faqs is not an array', async () => {
    const res = await PUT(await apiRequest('PUT', `http://localhost/api/admin/categories/${catId}/faqs`, { sid: fullSid, body: { faqs: 'nope' } }) as any, ctx)
    expect(res.status).toBe(400)
  })

  it('PUT 400 on an unparseable body', async () => {
    const req = await apiRequest('PUT', `http://localhost/api/admin/categories/${catId}/faqs`, { sid: fullSid })
    // Force a body that fails JSON.parse (handler catches → null → 400).
    const bad = new (await import('next/server')).NextRequest(req.url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${fullSid}`, 'Content-Type': 'application/json' },
      body: '{bad',
    })
    const res = await PUT(bad as any, ctx)
    expect(res.status).toBe(400)
  })

  it('PUT 200 inserts FAQs, persists them, and GET reads them back', async () => {
    const res = await PUT(
      await apiRequest('PUT', `http://localhost/api/admin/categories/${catId}/faqs`, {
        sid: fullSid,
        body: { faqs: [{ question: 'Q one', answer: 'A one' }, { question: 'Q two', answer: 'A two', published: false }] },
      }) as any,
      ctx
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.faqs.length).toBe(2)
    expect(body.faqs[0].question).toBe('Q one')
    expect(body.faqs[0].sort_order).toBe(0)
    expect(body.faqs[1].published).toBe(false)

    // Real DB: both rows exist under this category.
    const { rows } = await db.query(`SELECT question, answer, sort_order, published FROM category_faqs WHERE category_id = $1 ORDER BY sort_order`, [catId])
    expect(rows.length).toBe(2)
    expect(rows[0].question).toBe('Q one')
    expect(rows[1].published).toBe(false)
  })

  it('PUT replaces the list — omitted rows are deleted, blanks filtered', async () => {
    // Replace with a single valid row plus a blank one (question empty → filtered out).
    const res = await PUT(
      await apiRequest('PUT', `http://localhost/api/admin/categories/${catId}/faqs`, {
        sid: fullSid,
        body: { faqs: [{ question: 'Only one left', answer: 'Still here' }, { question: '', answer: 'dropped' }] },
      }) as any,
      ctx
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.faqs.length).toBe(1)
    expect(body.faqs[0].question).toBe('Only one left')

    const { rows } = await db.query(`SELECT count(*)::int AS n FROM category_faqs WHERE category_id = $1`, [catId])
    expect(rows[0].n).toBe(1)
  })
})
