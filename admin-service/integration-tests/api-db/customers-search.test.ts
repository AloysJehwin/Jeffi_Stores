// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — admin customers search. Scope gate + real users read:
// q<2 → empty, a 2+ char match against a seeded non-guest user returns that row.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES, uniqueSuffix } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin customers/search API (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  const userId = crypto.randomUUID()
  const sfx = uniqueSuffix()
  const email = `search-${sfx}@jeffi.test`

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/customers/search/route')
    GET = route.GET as any
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
    // Non-guest customer whose name is uniquely searchable.
    await db.query(
      `INSERT INTO users (id, email, first_name, last_name, user_type, is_guest)
       VALUES ($1, $2, 'Zephyrine', $3, 'customer', false)`,
      [userId, email, `Sur${sfx}`]
    )
  })

  afterAll(async () => {
    await db.query(`DELETE FROM users WHERE id = $1`, [userId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('401 without a session', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/customers/search?q=zephyrine') as any)
    expect(res.status).toBe(401)
  })

  it('403 for an admin lacking customers:read', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/customers/search?q=zephyrine', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('returns empty results for a query under 2 chars (no DB hit)', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/customers/search?q=z', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [] })
  })

  it('matches the seeded non-guest user by name', async () => {
    const res = await GET(await apiRequest('GET', `http://localhost/api/admin/customers/search?q=Sur${sfx}`, { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    const hit = body.results.find((r: any) => r.id === userId)
    expect(hit).toBeTruthy()
    expect(hit.full_name).toBe(`Zephyrine Sur${sfx}`)
    expect(hit.email).toBe(email)
  })
})
