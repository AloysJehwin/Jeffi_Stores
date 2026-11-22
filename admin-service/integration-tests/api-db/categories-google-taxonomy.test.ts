// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — google-taxonomy (GET search / POST match).
// GET: in-memory taxonomy search, gated only on an authenticated admin. POST: gated on categories:write;
// uses a categories:write-only admin (canUseAi=false) so the match is keyword-only, no AI gateway call.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin categories google-taxonomy API (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let POST: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let writeSid = ''
  let narrowSid = ''

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/categories/google-taxonomy/route')
    GET = route.GET as any
    POST = route.POST as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    // categories:write WITHOUT catalog_enrichment:write → scope gate passes, AI path is off.
    ;({ sid: writeSid } = await makeAdminSession(auth, FIXTURES.adminId, ['categories:write'], 'manager'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
  })

  afterAll(async () => {
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  // GET — any authenticated admin
  it('GET 401 without a session', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/categories/google-taxonomy?q=pet') as any)
    expect(res.status).toBe(401)
  })

  it('GET 200 ?value= returns the matching entry for a valid numeric id', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/categories/google-taxonomy?value=1', { sid: narrowSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.match).toBeTruthy()
    expect(body.match.path).toBe('Animals & Pet Supplies')
  })

  it('GET 200 ?q= shorter than 2 chars returns no results', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/categories/google-taxonomy?q=a', { sid: narrowSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.results).toEqual([])
  })

  it('GET 200 ?q= returns ranked search results', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/categories/google-taxonomy?q=pet%20supplies', { sid: narrowSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.results)).toBe(true)
    expect(body.results.length).toBeGreaterThan(0)
    expect(body.results[0]).toHaveProperty('path')
  })

  // POST — categories:write
  it('POST 401 without a session', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/admin/categories/google-taxonomy', { body: { name: 'Pet food' } }) as any)
    expect(res.status).toBe(401)
  })

  it('POST 403 for an admin lacking categories:write', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/admin/categories/google-taxonomy', { sid: narrowSid, body: { name: 'Pet food' } }) as any)
    expect(res.status).toBe(403)
  })

  it('POST 400 when no name is supplied', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/admin/categories/google-taxonomy', { sid: writeSid, body: {} }) as any)
    expect(res.status).toBe(400)
  })

  it('POST 200 returns a keyword match (no AI) for a categories:write admin', async () => {
    const res = await POST(await apiRequest('POST', 'http://localhost/api/admin/categories/google-taxonomy', { sid: writeSid, body: { name: 'Pet Supplies' } }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.match).toBeTruthy()
    expect(typeof body.match.path).toBe('string')
    expect(body.match.path.toLowerCase()).toContain('pet')
  })
})
