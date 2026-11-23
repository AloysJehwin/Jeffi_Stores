// @vitest-environment node
//
// DB-backed API test (jeffi_test) — controller ecom wallet. ownerApi reads the owner_sid via
// next/headers cookies() (request-scoped, unavailable when calling the handler directly), so we mock
// ONLY next/headers to feed the cookie — the session sid is REAL and resolveOwnerSession/getOwnerTenants
// run their real SQL against jeffi_test. 401 without a session; 200 with a seeded owner + tenant link.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import crypto from 'crypto'
import { API_DB_ENABLED, requireTestDb } from '../../../packages/store-core/integration-tests/db/harness'
import { makeOwnerSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

// Mutable cookie value the mocked cookies() store returns (set per test).
let ownerSidCookie: string | undefined
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => (name === 'owner_sid' && ownerSidCookie ? { value: ownerSidCookie } : undefined),
  }),
  headers: vi.fn().mockResolvedValue(new Headers()),
}))

describe.skipIf(!API_DB_ENABLED)('controller ecom wallet API (real DB, owner session)', () => {
  let GET: (req: any) => Promise<Response>
  let db: typeof import('@/lib/shared/db')
  let cp: any
  let sid = ''
  let ownerId = ''
  const tenantId = crypto.randomUUID()
  const slug = 'apitest-ecom-' + crypto.randomBytes(3).toString('hex')
  const email = `apitest-owner-${crypto.randomBytes(3).toString('hex')}@jeffi.test`

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const ownerSession = await import('@/lib/auth/owner-session')
    const reg = await import('@/lib/tenant-registry')
    cp = reg.controlPlanePool()
    const route = await import('@controller/app/api/(ecom)/ecom/wallet/route')
    GET = route.GET as any
    ;({ sid, owner: { id: ownerId } } = await makeOwnerSession(ownerSession, email))
    await cp.query(
      `INSERT INTO tenants (id, slug, display_name, status, service_types) VALUES ($1,$2,'API Test Ecom Store','active','{ecom}'::text[]) ON CONFLICT (id) DO NOTHING`,
      [tenantId, slug]
    )
    await cp.query(
      `INSERT INTO owner_tenants (owner_id, tenant_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [ownerId, tenantId]
    )
  })

  afterAll(async () => {
    await cp.query(`DELETE FROM owner_tenants WHERE owner_id=$1`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => {})
    await db.query(`DELETE FROM auth_sessions WHERE principal_id=$1 AND principal_type='owner'`, [ownerId]).catch(() => {})
    await cp.query(`DELETE FROM owners WHERE id=$1`, [ownerId]).catch(() => {})
    await endPool()
  })

  it('401 without an owner session', async () => {
    ownerSidCookie = undefined
    const res = await GET(await apiRequest('GET', `http://localhost/api/ecom/wallet?tenant=${slug}`) as any)
    expect(res.status).toBe(401)
  })

  it('200 with a valid owner session, returning the real tenant wallet shape', async () => {
    ownerSidCookie = sid
    const res = await GET(await apiRequest('GET', `http://localhost/api/ecom/wallet?tenant=${slug}`) as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('balance')
    expect(body).toHaveProperty('currency')
    expect(body).toHaveProperty('ledger')
  })
})
