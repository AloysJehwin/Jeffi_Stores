// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — categories overview (GET). Gated on categories:read via
// requireAdminScope. Reads Postgres only (group sales/stock aggregates + uncategorised count).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin categories overview API (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let readSid = ''
  let narrowSid = ''

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/categories/overview/route')
    GET = route.GET as any
    ;({ sid: readSid } = await makeAdminSession(auth, FIXTURES.adminId, ['categories:read'], 'manager'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
  })

  afterAll(async () => {
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('401 without a session', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/categories/overview') as any)
    expect(res.status).toBe(401)
  })

  it('403 for an admin lacking categories:read', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/categories/overview', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('200 returns the overview shape from the real DB', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/categories/overview?from=2026-01-01&to=2026-12-31', { sid: readSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('period')
    expect(body).toHaveProperty('previous')
    expect(body).toHaveProperty('totals')
    expect(body.totals).toHaveProperty('unassigned')
    expect(Array.isArray(body.top)).toBe(true)
    expect(Array.isArray(body.empty)).toBe(true)
    expect(Array.isArray(body.unused)).toBe(true)
    expect(Array.isArray(body.attention)).toBe(true)
  })
})
