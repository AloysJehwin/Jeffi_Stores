// @vitest-environment node
//
// DB-backed API test (jeffi_test tier) — admin customers list. Exemplar proving SCOPE validation:
// 401 (no session), 403 (admin session lacking customers:read), 200 (admin with it) — all through the
// real authenticateAdmin → resolveSession → hasScope chain against seeded admin sessions in jeffi_test.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

describe.skipIf(!API_DB_ENABLED)('admin customers API — scope gate (real DB)', () => {
  let GET: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    const route = await import('@admin/app/api/(admin)/admin/customers/route')
    GET = route.GET as any
    // Full platform admin (role 'administrator' → hasScope short-circuits) and a narrow non-platform
    // admin ('manager') whose scopes lack customers:read → must be 403.
    ;({ sid: fullSid } = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'))
    ;({ sid: narrowSid } = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'))
  })

  afterAll(async () => {
    // Sessions for this admin principal are the only rows we created.
    await db.query(`DELETE FROM auth_sessions WHERE principal_id = $1 AND principal_type='admin'`, [FIXTURES.adminId]).catch(() => {})
    await endPool()
  })

  it('401 without a session', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/customers') as any)
    expect(res.status).toBe(401)
  })

  it('403 for an admin session lacking customers:read', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/customers', { sid: narrowSid }) as any)
    expect(res.status).toBe(403)
  })

  it('200 for an admin with the scope, returning real seeded customers', async () => {
    const res = await GET(await apiRequest('GET', 'http://localhost/api/admin/customers?limit=5', { sid: fullSid }) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('customers')
    expect(Array.isArray(body.customers)).toBe(true)
    expect(body).toHaveProperty('total')
  })
})
