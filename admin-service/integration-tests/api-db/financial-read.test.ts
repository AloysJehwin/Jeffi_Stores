// @vitest-environment node
//
// DB-backed API tests (jeffi_test tier) — Finance read routes. Each route gates on
// `financial:read` through the real authenticateAdmin→resolveSession→hasScope chain.
// Proves 401 (no session), 403 (narrow admin), 200 (full admin) + real body shape, and
// date-range validation (400). Routes that read Postgres directly only; external-proxy
// routes (razorpay-settlements, route-payouts, marketplace-settlements) are covered/skip in
// a sibling note, not here.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { API_DB_ENABLED, requireTestDb, FIXTURES } from '../../../packages/store-core/integration-tests/db/harness'
import { makeAdminSession, apiRequest, endPool } from '../../../packages/store-core/integration-tests/db/helpers'

type Handler = (req: any) => Promise<Response>

describe.skipIf(!API_DB_ENABLED)('admin financial read routes — scope gate (real DB)', () => {
  let db: typeof import('@/lib/shared/db')
  let fullSid = ''
  let narrowSid = ''
  const sessionIds: string[] = []
  // Each route's GET and the base URL (routes read req.nextUrl.searchParams).
  const routes: Record<string, { get: Handler; url: string }> = {}

  beforeAll(async () => {
    requireTestDb()
    db = await import('@/lib/shared/db')
    const auth = await import('@/lib/auth/auth-sessions')
    let s = await makeAdminSession(auth, FIXTURES.adminId, ['*'], 'administrator'); fullSid = s.sid; sessionIds.push(s.id)
    s = await makeAdminSession(auth, FIXTURES.adminId, ['dashboard:read'], 'manager'); narrowSid = s.sid; sessionIds.push(s.id)

    const base = 'http://localhost/api/admin/financial'
    routes.overview = { get: (await import('@admin/app/api/(admin)/admin/financial/overview/route')).GET as Handler, url: `${base}/overview` }
    routes.cashflow = { get: (await import('@admin/app/api/(admin)/admin/financial/cashflow/route')).GET as Handler, url: `${base}/cashflow` }
    routes.transactions = { get: (await import('@admin/app/api/(admin)/admin/financial/transactions/route')).GET as Handler, url: `${base}/transactions` }
    routes.receivables = { get: (await import('@admin/app/api/(admin)/admin/financial/receivables/route')).GET as Handler, url: `${base}/receivables` }
    routes.pl = { get: (await import('@admin/app/api/(admin)/admin/financial/pl/route')).GET as Handler, url: `${base}/pl` }
    routes.aiCosts = { get: (await import('@admin/app/api/(admin)/admin/financial/ai-costs/route')).GET as Handler, url: `${base}/ai-costs` }
    routes.messagingSpend = { get: (await import('@admin/app/api/(admin)/admin/financial/messaging-spend/route')).GET as Handler, url: `${base}/messaging-spend` }
    routes.disputes = { get: (await import('@admin/app/api/(admin)/admin/financial/disputes/route')).GET as Handler, url: `${base}/disputes` }
  })

  afterAll(async () => {
    await db.query(`DELETE FROM auth_sessions WHERE id = ANY($1::uuid[])`, [sessionIds]).catch(() => {})
    await endPool()
  })

  for (const name of ['overview', 'cashflow', 'transactions', 'receivables', 'pl', 'aiCosts', 'messagingSpend', 'disputes']) {
    describe(name, () => {
      it('401 without a session', async () => {
        const { get, url } = routes[name]
        const res = await get(await apiRequest('GET', url) as any)
        expect(res.status).toBe(401)
      })

      it('403 for an admin lacking financial:read', async () => {
        const { get, url } = routes[name]
        const res = await get(await apiRequest('GET', url, { sid: narrowSid }) as any)
        expect(res.status).toBe(403)
      })

      it('200 for a full admin', async () => {
        const { get, url } = routes[name]
        const res = await get(await apiRequest('GET', url, { sid: fullSid }) as any)
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body).toBeTypeOf('object')
        expect(body).not.toHaveProperty('error')
      })
    })
  }

  // Range validation: invalid `from`/`to` → 400 before any query. Applies to every route that
  // parses a period (all but disputes, which has no from/to).
  for (const name of ['overview', 'cashflow', 'transactions', 'receivables', 'aiCosts', 'messagingSpend']) {
    it(`${name}: 400 on bad date range`, async () => {
      const { get, url } = routes[name]
      const res = await get(await apiRequest('GET', `${url}?from=2026-02-01&to=2026-01-01`, { sid: fullSid }) as any)
      expect(res.status).toBe(400)
    })
  }

  // Overview also surfaces a real contract shape when a valid range is given.
  it('overview: valid range returns a range-stamped body', async () => {
    const res = await routes.overview.get(
      await apiRequest('GET', `${routes.overview.url}?from=2026-01-01&to=2026-01-31`, { sid: fullSid }) as any
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.range).toMatchObject({ from: '2026-01-01', to: '2026-01-31' })
  })
})
